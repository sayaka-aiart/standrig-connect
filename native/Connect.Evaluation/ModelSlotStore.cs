using System.Text.Json;
namespace StandRig.Connect.Evaluation;

public sealed record TrackingGain(double Gain,bool Invert);
public sealed record TrackingControlsSnapshot(Dictionary<string,TrackingGain> Gains,double Smoothing,double EyeClosed,bool Enabled);
public sealed record ModelSlotInfo(string Id,string Name,string Revision,DateTimeOffset SavedAt) { public string? TrackingRevision {get;init;} public override string ToString()=>Name; }
public sealed record ModelSlotDocument(int Version,string ModelJson,string ProfileJson,TrackingControlsSnapshot Controls);
public sealed record SlotTrackingDocument(int Version,string ProfileJson,TrackingControlsSnapshot Controls);

/// <summary>Immutable payloads plus an atomically replaced small manifest. No source-file dependency.</summary>
public sealed class ModelSlotStore(string root)
{
    private static readonly JsonSerializerOptions Json=new(){WriteIndented=true};
    private string DirectoryFor(string id){if(!Guid.TryParseExact(id,"N",out _))throw new ArgumentException("Invalid slot ID");return Path.Combine(root,id);}
    public string? LastUsed(){
        var file=Path.Combine(root,"last-used.json");if(!File.Exists(file))return null;
        try{
            if(new FileInfo(file).Length>1024)return null;
            var id=JsonSerializer.Deserialize<string>(File.ReadAllText(file));
            return id!=null&&Guid.TryParseExact(id,"N",out _)&&File.Exists(Path.Combine(DirectoryFor(id),"slot.json"))?id:null;
        }catch(JsonException){return null;}
    }
    public void RememberUsed(string id){
        if(!File.Exists(Path.Combine(DirectoryFor(id),"slot.json")))throw new FileNotFoundException("Slot not found");
        var temporary=Path.Combine(root,"last-used-"+Guid.NewGuid().ToString("N")+".tmp");
        try{File.WriteAllText(temporary,JsonSerializer.Serialize(id));File.Move(temporary,Path.Combine(root,"last-used.json"),true);}
        finally{if(File.Exists(temporary))File.Delete(temporary);}
    }
    private static void Validate(ModelSlotDocument doc){
        if(doc.Version!=1)throw new InvalidDataException("Unsupported slot version");
        if(System.Text.Encoding.UTF8.GetByteCount(doc.ModelJson)>64*1024*1024||doc.ProfileJson.Length>1024*1024)throw new InvalidDataException("Slot data too large");
        using var model=JsonDocument.Parse(doc.ModelJson);
        if(!model.RootElement.TryGetProperty("parts",out var parts)||parts.ValueKind!=JsonValueKind.Array)throw new InvalidDataException("Invalid model");
        foreach(var asset in model.RootElement.GetProperty("assets").EnumerateArray())
            if(asset.GetProperty("src").GetString()?.StartsWith("data:image/png;base64,",StringComparison.Ordinal)!=true)throw new InvalidDataException("画像込みモデルJSONが必要です。");
        using var profile=JsonDocument.Parse(doc.ProfileJson);
        if(profile.RootElement.GetProperty("format").GetString()!="standrig-tracking-profile"||profile.RootElement.GetProperty("version").GetInt32()!=1)throw new InvalidDataException("Invalid tracking profile");
        var c=doc.Controls;
        if(!double.IsFinite(c.Smoothing)||c.Smoothing<0||c.Smoothing>.95||!double.IsFinite(c.EyeClosed)||c.EyeClosed<0||c.EyeClosed>.6||c.Gains.Count>32||c.Gains.Any(p=>!double.IsFinite(p.Value.Gain)||p.Value.Gain<0||p.Value.Gain>3))throw new InvalidDataException("Invalid tracking controls");
    }
    public IReadOnlyList<ModelSlotInfo> List(){
        if(!Directory.Exists(root))return [];
        var result=new List<ModelSlotInfo>();
        foreach(var dir in Directory.EnumerateDirectories(root)){
            var id=Path.GetFileName(dir);if(!Guid.TryParseExact(id,"N",out _))continue;
            string path=Path.Combine(dir,"slot.json");if(!File.Exists(path))continue;
            if(new FileInfo(path).Length>16384)throw new InvalidDataException("Slot manifest too large");
            var info=JsonSerializer.Deserialize<ModelSlotInfo>(File.ReadAllText(path))??throw new InvalidDataException("Invalid slot manifest");
            if(info.Id!=id||!Guid.TryParseExact(info.Revision,"N",out _)||info.TrackingRevision!=null&&!Guid.TryParseExact(info.TrackingRevision,"N",out _))throw new InvalidDataException("Invalid slot manifest ID");
            result.Add(info);
        }
        return result.OrderBy(s=>s.Name,StringComparer.CurrentCulture).ToArray();
    }
    public ModelSlotDocument Load(string id){
        var dir=DirectoryFor(id);var info=List().Single(s=>s.Id==id);
        var file=Path.Combine(dir,info.Revision+".json");
        if(new FileInfo(file).Length>96L*1024*1024)throw new InvalidDataException("Slot file too large");
        var doc=JsonSerializer.Deserialize<ModelSlotDocument>(File.ReadAllText(file))??throw new InvalidDataException("Invalid slot");
        if(info.TrackingRevision!=null){
            var trackingFile=Path.Combine(dir,"tracking-"+info.TrackingRevision+".json");
            if(new FileInfo(trackingFile).Length>8*1024*1024)throw new InvalidDataException("Tracking slot too large");
            var tracking=JsonSerializer.Deserialize<SlotTrackingDocument>(File.ReadAllText(trackingFile))??throw new InvalidDataException("Invalid tracking slot");
            if(tracking.Version!=1)throw new InvalidDataException("Unsupported tracking slot version");
            doc=doc with {ProfileJson=tracking.ProfileJson,Controls=tracking.Controls};
        }
        Validate(doc);return doc;
    }
    public ModelSlotInfo SaveTracking(string id,string expectedModel,string profile,TrackingControlsSnapshot controls){
        var info=List().Single(s=>s.Id==id);var saved=Load(id);
        if(saved.ModelJson!=expectedModel)throw new InvalidOperationException("保存先のモデルが変更されています。スロットを読み込み直してください。");
        Validate(saved with {ProfileJson=profile,Controls=controls});
        string revision=Guid.NewGuid().ToString("N");var dir=DirectoryFor(id);
        var updated=info with {TrackingRevision=revision,SavedAt=DateTimeOffset.UtcNow};
        File.WriteAllText(Path.Combine(dir,"tracking-"+revision+".json"),JsonSerializer.Serialize(new SlotTrackingDocument(1,profile,controls),Json));
        var temporary=Path.Combine(dir,"manifest-"+Guid.NewGuid().ToString("N")+".tmp");
        try{File.WriteAllText(temporary,JsonSerializer.Serialize(updated,Json));File.Move(temporary,Path.Combine(dir,"slot.json"),true);}
        finally{if(File.Exists(temporary))File.Delete(temporary);}
        return updated;
    }
    public ModelSlotInfo Save(string? id,string name,ModelSlotDocument doc){
        name=name.Trim();if(name.Length is <1 or >80)throw new ArgumentException("スロット名は1〜80文字にしてください。");Validate(doc);
        string key=id??Guid.NewGuid().ToString("N");var dir=DirectoryFor(key);
        if(id!=null&&!File.Exists(Path.Combine(dir,"slot.json")))throw new FileNotFoundException("Slot no longer exists");
        Directory.CreateDirectory(dir);string revision=Guid.NewGuid().ToString("N");
        var info=new ModelSlotInfo(key,name,revision,DateTimeOffset.UtcNow);
        // Never overwrite the active payload. Publish its pointer only after the payload is complete.
        string payload=JsonSerializer.Serialize(doc,Json);
        if(System.Text.Encoding.UTF8.GetByteCount(payload)>96L*1024*1024)throw new InvalidDataException("Slot file too large");
        File.WriteAllText(Path.Combine(dir,revision+".json"),payload);
        var temporary=Path.Combine(dir,"manifest-"+Guid.NewGuid().ToString("N")+".tmp");
        try{File.WriteAllText(temporary,JsonSerializer.Serialize(info,Json));File.Move(temporary,Path.Combine(dir,"slot.json"),true);}
        finally{if(File.Exists(temporary))File.Delete(temporary);}
        return info;
    }
}
