using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
namespace StandRig.Connect.Evaluation;

/// <summary>Bounded reader. Packed offsets remain compact until the V8 boundary.</summary>
public static class ModelDocument
{
    public const long MaxModelBytes=384L*1024*1024;
    public const long MaxSlotBytes=512L*1024*1024;
    public const int MaxMotionBytes=16*1024*1024;
    private const int MaxPngBytes=96*1024*1024;
    private const string PngPrefix="data:image/png;base64,";
    private static readonly JsonWriterOptions WriterOptions=new(){Encoder=JavaScriptEncoder.UnsafeRelaxedJsonEscaping};
    private static bool Envelope(JsonElement root,string name)=>root.ValueKind==JsonValueKind.Object&&root.TryGetProperty("format",out var format)&&format.ValueKind==JsonValueKind.String&&format.GetString()==name;
    private static JsonElement Inner(JsonElement root){
        if(!root.TryGetProperty("version",out var version)||version.ValueKind!=JsonValueKind.Number||!version.TryGetInt32(out int v)||v!=1||!root.TryGetProperty("rig",out var rig)||rig.ValueKind!=JsonValueKind.Object)throw new InvalidDataException("Unsupported model envelope");return rig;
    }
    public static JsonElement RigRoot(JsonElement root){
        if(Envelope(root,"standrig-bundle"))root=Inner(root);
        if(Envelope(root,"standrig-packed"))root=Inner(root);
        else if(root.ValueKind==JsonValueKind.Object&&root.TryGetProperty("format",out _))throw new InvalidDataException("Unsupported model format");
        if(root.ValueKind!=JsonValueKind.Object||!root.TryGetProperty("schemaVersion",out var schema)||schema.ValueKind!=JsonValueKind.String||!root.TryGetProperty("parts",out var parts)||parts.ValueKind!=JsonValueKind.Array||!root.TryGetProperty("assets",out var assets)||assets.ValueKind!=JsonValueKind.Array)throw new InvalidDataException("Invalid rig document");
        return root;
    }
    public static string Normalize(string json){
        if(Encoding.UTF8.GetByteCount(json)>MaxModelBytes)throw new InvalidDataException("Model exceeds 384 MiB limit");
        using var document=JsonDocument.Parse(json);var payload=document.RootElement;
        if(Envelope(payload,"standrig-bundle"))payload=Inner(payload);
        RigRoot(payload);
        return Envelope(document.RootElement,"standrig-bundle")?payload.GetRawText():json;
    }
    public static string Read(string path){
        if(new FileInfo(path).Length>MaxModelBytes)throw new InvalidDataException("Model exceeds 384 MiB limit");
        string json=Normalize(File.ReadAllText(path));
        using var document=JsonDocument.Parse(json);var rig=RigRoot(document.RootElement);
        if(!rig.GetProperty("assets").EnumerateArray().Any(a=>!(a.GetProperty("src").GetString()??"").StartsWith(PngPrefix,StringComparison.Ordinal)))return json;
        string directory=Path.GetDirectoryName(Path.GetFullPath(path))!;
        // Import local images once; saved slots then have no source-directory dependency.
        return Rewrite(document.RootElement,rig,(writer,asset)=>{
            string src=asset.GetProperty("src").GetString()??"";
            if(src.StartsWith(PngPrefix,StringComparison.Ordinal)){asset.WriteTo(writer);return;}
            byte[] bytes=PngBytes(asset,directory);
            writer.WriteStartObject();foreach(var item in asset.EnumerateObject()){
                if(item.Name=="src")writer.WriteString("src",PngPrefix+Convert.ToBase64String(bytes));else item.WriteTo(writer);
            }writer.WriteEndObject();
        });
    }
    public static byte[] PngBytes(JsonElement asset,string? directory=null,bool forRendering=false){
        string src=asset.GetProperty("src").GetString()??"";byte[] bytes;
        if(src.StartsWith(PngPrefix,StringComparison.Ordinal)){
            if(src.Length-PngPrefix.Length>((long)MaxPngBytes+2)/3*4)throw new InvalidDataException("PNG exceeds asset limit");
            bytes=Convert.FromBase64String(src[PngPrefix.Length..]);
        }else{
            if(directory==null)throw new InvalidDataException("External PNGs require the original model directory");
            string relative=Uri.UnescapeDataString(src).Replace('\\','/');
            if(relative.StartsWith("//",StringComparison.Ordinal)||relative.IndexOfAny([':', '?', '#', '\0'])>=0)throw new InvalidDataException("Only local model-relative PNGs are supported");
            string root=Path.GetFullPath(directory),file=Path.GetFullPath(Path.Combine(root,relative.TrimStart('/')));
            var comparison=OperatingSystem.IsWindows()?StringComparison.OrdinalIgnoreCase:StringComparison.Ordinal;
            if(!file.StartsWith(root+Path.DirectorySeparatorChar,comparison))throw new InvalidDataException("PNG escaped the model directory");
            string current=root;foreach(string part in Path.GetRelativePath(root,file).Split(Path.DirectorySeparatorChar)){
                current=Path.Combine(current,part);if((File.GetAttributes(current)&FileAttributes.ReparsePoint)!=0)throw new InvalidDataException("PNG links are not supported");
            }
            if(new FileInfo(file).Length>MaxPngBytes)throw new InvalidDataException("PNG exceeds asset limit");
            using var input=File.OpenRead(file);using var output=new BoundedStream(MaxPngBytes);input.CopyTo(output);bytes=output.ToArray();
        }
        if(bytes.Length>MaxPngBytes||bytes.Length<24||!bytes.AsSpan(0,8).SequenceEqual(new byte[]{137,80,78,71,13,10,26,10}))throw new InvalidDataException("Invalid PNG asset");
        uint width=BinaryPrimitives.ReadUInt32BigEndian(bytes.AsSpan(16,4)),height=BinaryPrimitives.ReadUInt32BigEndian(bytes.AsSpan(20,4));
        if(width==0||height==0||forRendering&&(width>4096||height>4096)||asset.TryGetProperty("width",out var w)&&w.GetDouble()!=width||asset.TryGetProperty("height",out var h)&&h.GetDouble()!=height)throw new InvalidDataException("PNG dimensions disagree or exceed the rendering limit");
        if(asset.TryGetProperty("sha256",out var hash)&&hash.ValueKind!=JsonValueKind.Null){
            string actual=Convert.ToHexString(SHA256.HashData(bytes));if(hash.ValueKind!=JsonValueKind.String||!string.Equals(hash.GetString(),actual,StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("PNG hash mismatch");
        }
        return bytes;
    }
    public static string EvaluationJson(string json){
        using var document=JsonDocument.Parse(Normalize(json));
        return Rewrite(document.RootElement,RigRoot(document.RootElement),(writer,asset)=>{
            writer.WriteStartObject();foreach(var item in asset.EnumerateObject()){
                if(item.Name=="src")writer.WriteString("src","embedded:png");else item.WriteTo(writer);
            }writer.WriteEndObject();
        });
    }
    private static string Rewrite(JsonElement payload,JsonElement rig,Action<Utf8JsonWriter,JsonElement> assetWriter){
        using var stream=new BoundedStream(MaxModelBytes);using(var writer=new Utf8JsonWriter(stream,WriterOptions)){
            void WriteRig(){writer.WriteStartObject();foreach(var property in rig.EnumerateObject()){
                if(property.Name!="assets"){property.WriteTo(writer);continue;}writer.WriteStartArray("assets");foreach(var asset in property.Value.EnumerateArray())assetWriter(writer,asset);writer.WriteEndArray();
            }writer.WriteEndObject();}
            if(Envelope(payload,"standrig-packed")){writer.WriteStartObject();foreach(var property in payload.EnumerateObject()){
                if(property.Name=="rig"){writer.WritePropertyName("rig");WriteRig();}else property.WriteTo(writer);
            }writer.WriteEndObject();}else WriteRig();
        }
        return Encoding.UTF8.GetString(stream.GetBuffer(),0,checked((int)stream.Length));
    }
    private sealed class BoundedStream(long maximum):MemoryStream {
        private void Check(int count){if(Position+count>maximum)throw new InvalidDataException("Expanded document exceeds its byte limit");}
        public override void Write(byte[] buffer,int offset,int count){Check(count);base.Write(buffer,offset,count);}
        public override void Write(ReadOnlySpan<byte> buffer){Check(buffer.Length);base.Write(buffer);}
        public override void WriteByte(byte value){Check(1);base.WriteByte(value);}
    }
}
