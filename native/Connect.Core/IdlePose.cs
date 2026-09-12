namespace StandRig.Connect;

public enum IdlePreset { Off, Breathing, Sway, Random }

// Render-worker owned. Smooth, bounded offsets; never edits the input/model.
public sealed class IdlePose
{
    private readonly Dictionary<string,double> offsets=new();
    private double? previousTime;
    public double BreathingStretch {get;private set;}
    public Dictionary<string,double> Apply(IReadOnlyDictionary<string,double> input,IReadOnlyDictionary<string,(double Min,double Max)> ranges,double seconds,IdlePreset preset,bool breathBound=true)
    {
        if(!double.IsFinite(seconds))throw new ArgumentOutOfRangeException(nameof(seconds));
        double dt=previousTime.HasValue?Math.Clamp(seconds-previousTime.Value,0,.1):0;
        previousTime=seconds;
        if(preset==IdlePreset.Off&&offsets.Count==0&&BreathingStretch<1e-8)return input as Dictionary<string,double>??new Dictionary<string,double>(input);
        double blend=1-Math.Exp(-dt/0.6);
        BreathingStretch+=((preset!=IdlePreset.Off&&!breathBound?.012*(1-Math.Cos(seconds*2*Math.PI/4.8))/2:0)-BreathingStretch)*blend;
        var desired=new Dictionary<string,double>();
        void Set(string id,double fraction){if(ranges.TryGetValue(id,out var r))desired[id]=(r.Max-r.Min)*fraction;}
        if(preset!=IdlePreset.Off){
            double breath=(1-Math.Cos(seconds*2*Math.PI/4.8))/2;
            if(breathBound&&ranges.ContainsKey("ParamBreath"))Set("ParamBreath",.35*breath);

            if(preset==IdlePreset.Sway){
                Set("ParamBodyAngleX",.05*Math.Sin(seconds*2*Math.PI/11));
                Set("ParamBodyAngleZ",.03*Math.Sin(seconds*2*Math.PI/13));
                Set("ParamAngleZ",.04*Math.Sin(seconds*2*Math.PI/9));
            }
            if(preset==IdlePreset.Random){
                Set("ParamAngleX",.07*Noise(seconds,17));
                Set("ParamAngleY",.05*Noise(seconds,43));
                Set("ParamAngleZ",.04*Noise(seconds,71));
                Set("ParamBodyAngleX",.04*Noise(seconds,101));
                Set("ParamBodyAngleZ",.03*Noise(seconds,137));
            }
        }
        var result=new Dictionary<string,double>(input);
        foreach(var id in offsets.Keys.Concat(desired.Keys).Distinct().ToArray()){
            double offset=offsets.GetValueOrDefault(id);
            offset+=(desired.GetValueOrDefault(id)-offset)*blend;
            if(Math.Abs(offset)<1e-8&&!desired.ContainsKey(id)){offsets.Remove(id);continue;}
            offsets[id]=offset;
            if(ranges.TryGetValue(id,out var r))result[id]=Math.Clamp(input.GetValueOrDefault(id)+offset,r.Min,r.Max);
        }
        return result;
    }
    private static double Noise(double seconds,uint seed){
        double position=Math.Max(0,seconds)/5;
        uint segment=unchecked((uint)(long)Math.Floor(position));
        double t=position-Math.Floor(position);t=t*t*t*(t*(t*6-15)+10);
        double Value(uint index){uint x=unchecked(index*747796405u+seed*2891336453u);x=unchecked(((x>>((int)(x>>28)+4))^x)*277803737u);x=(x>>22)^x;return x/(double)uint.MaxValue*2-1;}
        return Value(segment)*(1-t)+Value(unchecked(segment+1))*t;
    }
}
