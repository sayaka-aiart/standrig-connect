using System.Text;
using System.Text.Json;
namespace StandRig.Connect.Evaluation;

/// <summary>Shared bounded reader for raw rigs and image-embedded bundle v1 files.</summary>
public static class ModelDocument
{
    public const long MaxModelBytes=256L*1024*1024;
    public const long MaxSlotBytes=512L*1024*1024;
    public static string Read(string path){
        if(new FileInfo(path).Length>MaxModelBytes)throw new InvalidDataException("Model exceeds 256 MiB limit");
        return Normalize(File.ReadAllText(path));
    }
    public static string Normalize(string json){
        if(Encoding.UTF8.GetByteCount(json)>MaxModelBytes)throw new InvalidDataException("Model exceeds 256 MiB limit");
        using var document=JsonDocument.Parse(json);
        var root=document.RootElement;
        if(root.ValueKind!=JsonValueKind.Object)throw new InvalidDataException("Invalid model document");
        bool bundle=root.TryGetProperty("format",out var format);
        if(bundle){
            if(format.GetString()!="standrig-bundle"||!root.TryGetProperty("version",out var version)||!version.TryGetInt32(out int v)||v!=1||!root.TryGetProperty("rig",out root))throw new InvalidDataException("Unsupported model bundle");
        }
        if(root.ValueKind!=JsonValueKind.Object||!root.TryGetProperty("schemaVersion",out var schema)||schema.ValueKind!=JsonValueKind.String||!root.TryGetProperty("parts",out var parts)||parts.ValueKind!=JsonValueKind.Array||!root.TryGetProperty("assets",out var assets)||assets.ValueKind!=JsonValueKind.Array)throw new InvalidDataException("Invalid rig document");
        return bundle?root.GetRawText():json;
    }
    // Geometry evaluation needs asset IDs and dimensions, never megabytes of base64 pixels.
    public static string EvaluationJson(string json){
        using var document=JsonDocument.Parse(Normalize(json));
        using var stream=new MemoryStream();
        using(var writer=new Utf8JsonWriter(stream)){
            writer.WriteStartObject();
            foreach(var property in document.RootElement.EnumerateObject()){
                if(property.Name!="assets"){property.WriteTo(writer);continue;}
                writer.WriteStartArray("assets");
                foreach(var asset in property.Value.EnumerateArray()){
                    writer.WriteStartObject();
                    foreach(var item in asset.EnumerateObject()){
                        if(item.Name=="src")writer.WriteString("src","embedded:png");else item.WriteTo(writer);
                    }
                    writer.WriteEndObject();
                }
                writer.WriteEndArray();
            }
            writer.WriteEndObject();
        }
        return Encoding.UTF8.GetString(stream.GetBuffer(),0,checked((int)stream.Length));
    }
}
