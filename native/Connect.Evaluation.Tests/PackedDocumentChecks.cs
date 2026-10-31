using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using StandRig.Connect.Evaluation;
internal static class PackedDocumentChecks
{
    public static void Run(){
        string fixtureText=File.ReadAllText("scripts/evaluation/packed-fixtures.json");
        using var encoded=JsonDocument.Parse(fixtureText);
        using var fixtures=JsonDocument.Parse(fixtureText.Replace("\"fixture:png\"",JsonSerializer.Serialize("data:image/png;base64,"+encoded.RootElement.GetProperty("pngBase64").GetString())));
        const string query="""{"time":0.25,"values":{"X":0.35,"Y":-0.6},"physics":false}""";
        foreach(var item in fixtures.RootElement.GetProperty("cases").EnumerateArray()){
            string packed=item.GetProperty("packed").GetRawText(),plain=item.GetProperty("expected").GetRawText();
            if(ModelDocument.Normalize(packed)!=packed)throw new Exception("Packed document was expanded in managed code");
            using var evaluator=new ModelEvaluator();evaluator.Load(plain);var expected=evaluator.Render(query);
            evaluator.Load(packed);var actual=evaluator.Render(query);
            if(!actual.Vertices.SequenceEqual(expected.Vertices)||!actual.Indices.SequenceEqual(expected.Indices)||actual.Metadata!=expected.Metadata)throw new Exception("Packed native parity failed: "+item.GetProperty("name"));
            string bundle="{\"format\":\"standrig-bundle\",\"version\":1,\"rig\":"+packed+"}";
            evaluator.Load(bundle);if(!evaluator.Render(query).Vertices.SequenceEqual(expected.Vertices))throw new Exception("Nested bundle failed");
        }
        var source=JsonNode.Parse(fixtures.RootElement.GetProperty("cases")[0].GetProperty("packed").GetRawText())!;
        string directory=Path.GetFullPath(Path.Combine(Path.GetTempPath(),"connect-packed-"+Guid.NewGuid().ToString("N")));
        try{
            string modelDirectory=Path.Combine(directory,"model"),assetDirectory=Path.Combine(modelDirectory,"assets");Directory.CreateDirectory(assetDirectory);
            var asset=source["rig"]!["assets"]![0]!;byte[] png=Convert.FromBase64String(asset["src"]!.GetValue<string>().Split(',')[1]);
            File.WriteAllBytes(Path.Combine(assetDirectory,"pixel.png"),png);File.WriteAllBytes(Path.Combine(directory,"outside.png"),png);
            asset["src"]="/assets/pixel.png";asset["sha256"]=Convert.ToHexString(SHA256.HashData(png)).ToLowerInvariant();string modelPath=Path.Combine(modelDirectory,"rig.json");
            File.WriteAllText(modelPath,source.ToJsonString());string imported=ModelDocument.Read(modelPath);
            using var doc=JsonDocument.Parse(imported);var rig=ModelDocument.RigRoot(doc.RootElement);
            if(!ModelDocument.PngBytes(rig.GetProperty("assets")[0],forRendering:true).SequenceEqual(png)||!rig.GetProperty("parts")[0].GetProperty("artMesh").GetProperty("multiBindings")[0].GetProperty("keyforms")[0].TryGetProperty("packedOffsets",out _))throw new Exception("External import altered image/packed geometry");
            using var evalJson=JsonDocument.Parse(ModelDocument.EvaluationJson(imported));if(ModelDocument.RigRoot(evalJson.RootElement).GetProperty("assets")[0].GetProperty("src").GetString()!="embedded:png")throw new Exception("Pixels leaked into evaluation");
            using var evaluator=new ModelEvaluator();using var meta=JsonDocument.Parse(evaluator.Load(imported));var before=evaluator.Render(query);
            var store=new ModelSlotStore(Path.Combine(directory,"slots"));string profile=DefaultTracking.Create(meta.RootElement.GetProperty("parameters"));
            var slot=store.Save(null,"packed",new(1,imported,profile,new(new(),.15,.4,false)));File.Delete(Path.Combine(assetDirectory,"pixel.png"));
            var restored=store.Load(slot.Id);if(restored.ModelJson!=imported)throw new Exception("Slot changed packed document");evaluator.Load(restored.ModelJson);if(!evaluator.Render(query).Vertices.SequenceEqual(before.Vertices))throw new Exception("Slot depends on deleted external image");
            foreach(string path in new[]{"../outside.png","%2e%2e/outside.png","//server/image.png","https://example.invalid/image.png"}){
                asset["src"]=path;File.WriteAllText(modelPath,source.ToJsonString());bool rejected=false;try{ModelDocument.Read(modelPath);}catch(InvalidDataException){rejected=true;}if(!rejected)throw new Exception("External path escape accepted");
            }
            asset["src"]="/assets/pixel.png";File.WriteAllBytes(Path.Combine(assetDirectory,"pixel.png"),png);asset["sha256"]=new string('0',64);File.WriteAllText(modelPath,source.ToJsonString());
            bool badHash=false;try{ModelDocument.Read(modelPath);}catch(InvalidDataException){badHash=true;}if(!badHash)throw new Exception("External image corruption accepted");
        }finally{if(Path.GetDirectoryName(directory)!=Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar)||!Path.GetFileName(directory).StartsWith("connect-packed-"))throw new Exception("Invalid test directory");Directory.Delete(directory,true);}
        MotionLimit();
        Console.WriteLine("PASS packed native rendering parity, external PNG import/path/hash, independent slots and managed metadata-only geometry");
    }
    private static void MotionLimit(){
        using var evaluator=new ModelEvaluator();
        var parameters=Enumerable.Range(0,12).Select(i=>new{id="P"+i,label="P"+i,min=-1,max=1,@default=0}).ToArray();
        evaluator.Load(JsonSerializer.Serialize(new{schemaVersion="0.1.0",name="motion",stage=new{width=64,height=64},parts=Array.Empty<object>(),assets=Array.Empty<object>(),parameters,physics=new{enabled=false,chains=Array.Empty<object>()}}));
        const int count=4000;double Time(int i)=>10d*i/(count-1);double Value(int i)=>.5*Math.Sin(i*.01);
        using var stream=new MemoryStream();using(var writer=new Utf8JsonWriter(stream)){
            writer.WriteStartObject();writer.WriteString("format","standrig-motion");writer.WriteNumber("version",1);writer.WriteString("name","Large motion");writer.WriteNumber("duration",10);writer.WriteStartArray("tracks");
            foreach(var p in parameters){writer.WriteStartObject();writer.WriteString("parameter",p.id);writer.WriteStartArray("keys");
                for(int i=0;i<count;i++){writer.WriteStartObject();writer.WriteNumber("time",Time(i));writer.WriteNumber("value",Value(i));if(i<count-1){writer.WriteStartObject("segment");writer.WriteString("kind","bezier");writer.WriteStartObject("control1");writer.WriteNumber("time",Time(i)+(Time(i+1)-Time(i))/3);writer.WriteNumber("value",Value(i));writer.WriteEndObject();writer.WriteStartObject("control2");writer.WriteNumber("time",Time(i)+(Time(i+1)-Time(i))*2/3);writer.WriteNumber("value",Value(i+1));writer.WriteEndObject();writer.WriteEndObject();}writer.WriteEndObject();}
                writer.WriteEndArray();writer.WriteEndObject();
            }writer.WriteEndArray();writer.WriteEndObject();
        }
        string motion=Encoding.UTF8.GetString(stream.ToArray());if(stream.Length<=4*1024*1024||stream.Length>ModelDocument.MaxMotionBytes)throw new Exception("Invalid large-motion test size");
        var playback=new MotionPlayback();playback.Submit(MotionAction.Load,motion);playback.Advance(evaluator,0);if(playback.State.Error!=null)throw new Exception(playback.State.Error);
        using var sampled=JsonDocument.Parse(evaluator.SampleMotion(Time(1234)));foreach(var value in sampled.RootElement.EnumerateObject())if(value.Value.GetDouble()!=Value(1234))throw new Exception("Large motion changed a key");
        bool rejected=false;try{evaluator.LoadMotion(new string('a',ModelDocument.MaxMotionBytes+1));}catch(ArgumentException){rejected=true;}if(!rejected)throw new Exception("Oversized motion accepted");
        Console.WriteLine("PASS >4 MiB motion, 48,000 original keys and 16 MiB byte limit");
    }
}
