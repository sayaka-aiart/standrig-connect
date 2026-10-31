using System.Text.Json;
using StandRig.Connect.Evaluation;
internal static class ModelDocumentChecks
{
    public static void Run(){
        const string rig="""{"schemaVersion":"0.1.0","name":"reader","parts":[],"assets":[{"id":"a","type":"image","src":"data:image/png;base64,AAAA","width":1,"height":1}],"parameters":[],"stage":{"width":1,"height":1}}""";
        string bundle="{\"format\":\"standrig-bundle\",\"version\":1,\"rig\":"+rig+"}";
        if(ModelDocument.Normalize(rig)!=rig||ModelDocument.Normalize(bundle)!=rig)throw new Exception("Model envelope changed rig");
        using var eval=JsonDocument.Parse(ModelDocument.EvaluationJson(bundle));
        if(eval.RootElement.GetProperty("assets")[0].GetProperty("src").GetString()!="embedded:png"||eval.RootElement.GetProperty("assets")[0].GetProperty("width").GetInt32()!=1)throw new Exception("Evaluation asset metadata changed");
        foreach(string bad in new[]{"[]","{}",bundle.Replace("standrig-bundle","unknown"),bundle.Replace("\"version\":1","\"version\":2"),bundle.Replace("\"rig\":"+rig,"\"rig\":null")}){
            bool rejected=false;try{ModelDocument.Normalize(bad);}catch(InvalidDataException){rejected=true;}if(!rejected)throw new Exception("Invalid bundle accepted");
        }
        string path=Path.GetTempFileName();
        try{using(var file=new FileStream(path,FileMode.Open)){file.SetLength(ModelDocument.MaxModelBytes+1);}try{ModelDocument.Read(path);throw new Exception("Oversize model accepted");}catch(InvalidDataException){}}
        finally{File.Delete(path);}
        var directory=Path.Combine("reports","document-slot-tests-"+Guid.NewGuid().ToString("N"));var store=new ModelSlotStore(directory);
        var controls=new TrackingControlsSnapshot(new(),.15,.4,false);
        const string profile="""{"format":"standrig-tracking-profile","version":1,"name":"test","tracking":{"enabled":false,"mappings":[]}}""";
        var original=new ModelSlotDocument(1,rig,profile,controls);var slot=store.Save(null,"test",original);
        string metadataPath=Path.Combine(directory,slot.Id,slot.Revision+".json"),modelPath=Path.Combine(directory,slot.Id,slot.Revision+".srig");
        string metadata=File.ReadAllText(metadataPath);
        File.WriteAllText(metadataPath,JsonSerializer.Serialize(original));if(store.Load(slot.Id).ModelJson!=rig)throw new Exception("Legacy slot not readable");
        File.WriteAllText(metadataPath,metadata);File.AppendAllText(modelPath," ");
        bool corruptRejected=false;try{store.Load(slot.Id);}catch(InvalidDataException){corruptRejected=true;}if(!corruptRejected)throw new Exception("Corrupt model accepted");
        File.WriteAllText(modelPath,rig);var payload=JsonSerializer.Deserialize<ModelSlotPayloadV2>(metadata)!;
        File.WriteAllText(metadataPath,JsonSerializer.Serialize(payload with{ModelFile="../escape.srig"}));
        bool pathRejected=false;try{store.Load(slot.Id);}catch(InvalidDataException){pathRejected=true;}if(!pathRejected)throw new Exception("Slot model path escape accepted");
        File.WriteAllText(metadataPath,metadata);if(store.Load(slot.Id).ModelJson!=rig)throw new Exception("Model restore failed");
        Console.WriteLine("PASS raw rig, bundle v1, metadata-only evaluation, malformed envelope and bounded file reader");
        Console.WriteLine("PASS legacy slot read, v2 model integrity, path validation and restoration");
    }
    public static void RunFile(string path,string directory){
        string model=ModelDocument.Read(path);using var document=JsonDocument.Parse(model);
        string profile=DefaultTracking.Create(ModelDocument.RigRoot(document.RootElement).GetProperty("parameters"));
        var controls=new TrackingControlsSnapshot(new(),.15,.4,false);
        var store=new ModelSlotStore(directory);var slot=store.Save(null,"Large bundle roundtrip",new(1,model,profile,controls));
        var restored=store.Load(slot.Id);
        if(restored.ModelJson!=model||restored.ProfileJson!=profile)throw new Exception("Large bundle slot changed model/profile");
        File.WriteAllText(Path.Combine(directory,"result.json"),JsonSerializer.Serialize(new{passed=true,modelBytes=System.Text.Encoding.UTF8.GetByteCount(model),images=ModelDocument.RigRoot(document.RootElement).GetProperty("assets").GetArrayLength(),modelPreserved=true,profilePreserved=true}));
        Console.WriteLine("PASS large embedded bundle slot save and reload without source changes");
    }
}
