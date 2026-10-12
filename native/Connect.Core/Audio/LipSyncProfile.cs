using System.Text.Json;
namespace StandRig.Connect.Audio;

public sealed record LipSyncProfile(int Version,Dictionary<string,double[]> Vowels)
{
    public static readonly string[] VowelIds={"A","I","U","E","O"};
    public static LipSyncProfile Empty()=>new(1,new());
    public bool Ready=>VowelIds.All(Vowels.ContainsKey);
    public LipSyncProfile Copy()=>new(Version,Vowels.ToDictionary(p=>p.Key,p=>(double[])p.Value.Clone()));
    public void Validate()
    {
        if(Version!=1||Vowels==null||Vowels.Count>5||Vowels.Any(p=>!VowelIds.Contains(p.Key)||p.Value==null||p.Value.Length!=MfccAnalyzer.Coefficients||p.Value.Any(v=>!double.IsFinite(v)||Math.Abs(v)>10000)))throw new ArgumentException("Invalid lipsync profile");
    }
    // Adapted from uLipSync LipSyncJob.CalcL2NormScore/CalcScores (MIT, hecomi).
    // Standardization is disabled as in upstream defaults. Subtracting the nearest
    // distance preserves normalized ratios while preventing complete underflow.
    public Dictionary<string,double> Classify(double[] mfcc)
    {
        Validate();if(!Ready||mfcc.Length!=12||mfcc.Any(v=>!double.IsFinite(v)||Math.Abs(v)>10000))throw new ArgumentException("Calibrate all five vowels first");
        var distances=VowelIds.ToDictionary(id=>id,id=>Math.Sqrt(Vowels[id].Zip(mfcc,(a,b)=>(a-b)*(a-b)).Average()));
        double nearest=distances.Values.Min();var scores=distances.ToDictionary(p=>p.Key,p=>Math.Pow(10,-(p.Value-nearest)));double sum=scores.Values.Sum();
        return scores.ToDictionary(p=>p.Key,p=>p.Value/sum);
    }
}

public sealed record LipSyncSettings(string? DeviceId,LipSyncProfile Profile,double Gain=1,double GateDb=-50,double FullDb=-20,int DelayMs=0)
{
    public void Validate(){if(Profile==null)throw new ArgumentException("Missing lipsync profile");Profile.Validate();if(DeviceId?.Length>1024||!double.IsFinite(Gain)||Gain<.1||Gain>8||!double.IsFinite(GateDb)||!double.IsFinite(FullDb)||GateDb< -80||GateDb> -35||FullDb< -30||FullDb> -5||FullDb-GateDb<5||DelayMs<0||DelayMs>2000)throw new ArgumentException("Invalid lipsync settings");}
    public static LipSyncSettings Defaults()=>new(null,LipSyncProfile.Empty());
    public static LipSyncSettings Load(string path)
    {
        if(!File.Exists(path))return Defaults();if(new FileInfo(path).Length>32768)throw new ArgumentException("Lipsync settings exceed 32 KiB");
        var options=new JsonSerializerOptions{UnmappedMemberHandling=System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow};
        var value=JsonSerializer.Deserialize<LipSyncSettings>(File.ReadAllText(path),options)??throw new ArgumentException("Invalid lipsync settings");value.Validate();return value;
    }
    public void Save(string path)
    {
        Validate();Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path))!);string temp=path+"."+Guid.NewGuid().ToString("N")+".tmp";
        try{File.WriteAllText(temp,JsonSerializer.Serialize(this,new JsonSerializerOptions{WriteIndented=true}));File.Move(temp,path,true);}finally{if(File.Exists(temp))File.Delete(temp);}
    }
}
