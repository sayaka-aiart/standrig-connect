using System.Text.Json;
using System.Text.Json.Nodes;
namespace StandRig.Connect.Evaluation;

public static class DefaultTracking
{
    public const double EyeClosedDefault=.55;
    public static readonly (string Source,string Parameter,string Label,double Scale,bool Invert)[] Mappings = {
        ("faceYaw","ParamAngleX","顔・左右",15,true),("facePitch","ParamAngleY","顔・上下",30,false),("faceRoll","ParamAngleZ","顔・傾き",15,false),
        ("bodyRoll","ParamBodyAngleZ","体・傾き",15,false),("bodyYaw","ParamBodyAngleX","体・左右",8,true),("bodyPitch","ParamBodyAngleY","体・上下",20,false),
        ("eyeLOpen","ParamEyeROpen","自分の左目の開閉",1,false),("eyeROpen","ParamEyeLOpen","自分の右目の開閉",1,false),
        ("mouthOpen","ParamMouthOpen","口の開閉",1,false),("mouthForm","ParamMouthForm","口の形",1,false),
        ("eyeBallX","ParamEyeBallX","視線・左右",1,false),("eyeBallY","ParamEyeBallY","視線・上下",1,false)
    };
    private static bool IsEye(string source)=>source is "eyeLOpen" or "eyeROpen";
    public static string Create(JsonElement parameters)
    {
        var ids=parameters.EnumerateArray().Select(p=>p.GetProperty("id").GetString()).ToHashSet();
        return JsonSerializer.Serialize(new {format="standrig-tracking-profile",version=1,name="Connect standard v3",tracking=new {
            enabled=true,provider="mediapipe-face-landmarker",inputSmoothing=0,eyeSync=new {enabled=false,winkThreshold=.35,leftGain=1,rightGain=1},
            mappings=Mappings.Where(m=>ids.Contains(m.Parameter)).Select(m=>new {id=m.Source,enabled=true,source=m.Source,parameter=m.Parameter,scale=IsEye(m.Source)?1/(1-EyeClosedDefault):m.Scale,offset=IsEye(m.Source)?-EyeClosedDefault/(1-EyeClosedDefault):0,smoothing=IsEye(m.Source)?0:.15,filter="ema",invert=m.Invert})
        }});
    }
    public static string UpgradeProfile(string json)
    {
        var root=JsonNode.Parse(json)!;
        string? name=root["name"]?.GetValue<string>();
        if(name is not ("Connect standard" or "Connect standard v2"))return json;
        foreach(var node in root["tracking"]!["mappings"]!.AsArray()){
            string? source=node?["source"]?.GetValue<string>();
            string? parameter=node?["parameter"]?.GetValue<string>();
            double factor=source=="facePitch"&&parameter=="ParamAngleY"?2:source=="bodyPitch"&&parameter=="ParamBodyAngleY"?2.5:1;
            if(name=="Connect standard"&&factor!=1)node!["scale"]=node["scale"]!.GetValue<double>()*factor;
        }
        foreach(var node in root["tracking"]!["mappings"]!.AsArray())
            if(node?["source"]?.GetValue<string>()=="facePitch"&&node["parameter"]?.GetValue<string>()=="ParamAngleY")
                node["invert"]=!(node["invert"]?.GetValue<bool>()??false);
        root["name"]="Connect standard v3";
        return root.ToJsonString();
    }
    public static string Adjust(string json,IReadOnlyDictionary<string,(double Gain,bool Invert)> gains,double smoothing,double eyeClosed=EyeClosedDefault)
    {
        if(!double.IsFinite(eyeClosed)||eyeClosed<0||eyeClosed>.6)throw new ArgumentException("Invalid eye closure threshold");
        var root=JsonNode.Parse(json)!;
        foreach(var node in root["tracking"]!["mappings"]!.AsArray()) {
            string source=node!["source"]!.GetValue<string>();
            var baseline=Mappings.FirstOrDefault(m=>m.Source==source);
            if(baseline.Source==null)continue;
            if(gains.TryGetValue(source,out var adjustment)){node["scale"]=baseline.Scale*adjustment.Gain;node["invert"]=baseline.Invert ^ adjustment.Invert;}
            if(IsEye(source)){double gain=gains.TryGetValue(source,out var eyeGain)?eyeGain.Gain:1;node["scale"]=gain/(1-eyeClosed);node["offset"]=node["invert"]?.GetValue<bool>()==true?gain:-eyeClosed*gain/(1-eyeClosed);}
            node["smoothing"]=IsEye(source)?0:smoothing;node["filter"]="ema";
        }
        return root.ToJsonString();
    }
}
