using System.Diagnostics;
using System.Text.Json;
namespace StandRig.Connect.Evaluation;

public sealed record TrackingPlaybackState(bool Loaded,bool Enabled,bool Active,long Sequence,string? Error){public string? ProfileJson {get;init;}}

/// <summary>Latest-only normalized input. Camera/inference is a separate producer.</summary>
public sealed class TrackingPlayback
{
    private sealed record Sample(long Sequence,Dictionary<string,double> Inputs,double Received);
    private readonly object gate=new();
    private readonly Func<double> clock;
    private Sample? pending;
    private Sample? lastAccepted;
    private int calibration;
    public void CalibrateNeutral(){lock(gate){calibration=1;}}
    public void ClearCalibration(){lock(gate){calibration=2;}}
    private string? profile;
    private readonly Dictionary<string,(double Gain,bool Invert)> gains=new();
    private double smoothing=.15;
    private double eyeClosed=DefaultTracking.EyeClosedDefault;
    private bool adjust;
    private TaskCompletionSource<string>? snapshotRequest;
    public Task<string> CaptureProfileAsync(){lock(gate){snapshotRequest??=new(TaskCreationOptions.RunContinuationsAsynchronously);return snapshotRequest.Task;}}
    public void Adjust(string source,double gain,bool invert,double smooth,double closed=DefaultTracking.EyeClosedDefault) {
        if(!double.IsFinite(gain)||gain<0||gain>3||!double.IsFinite(smooth)||smooth<0||smooth>.95||!double.IsFinite(closed)||closed<0||closed>.6)throw new ArgumentException("Invalid tracking adjustment");
        lock(gate){gains[source]=(gain,invert);smoothing=smooth;eyeClosed=closed;adjust=true;}
    }
    private bool enabled;
    private bool reset;
    private long sequence=-1;
    private Dictionary<string,double>? overlay;
    private double acceptedAt;
    private TrackingPlaybackState state=new(false,false,false,-1,null);
    public TrackingPlaybackState State=>Volatile.Read(ref state);
    public TrackingPlayback(Func<double>? monotonicClock=null){clock=monotonicClock??(()=>Stopwatch.GetTimestamp()/(double)Stopwatch.Frequency);}
    public void LoadProfile(string json){if(json.Length>1024*1024)throw new ArgumentException("Tracking profile exceeds 1 MiB");lock(gate){profile=json;pending=null;}}
    public void SetEnabled(bool value){lock(gate){enabled=value;pending=null;reset=true;}}
    public bool Submit(long id,IReadOnlyDictionary<string,double> inputs)
    {
        if(id<0||inputs.Count>32||inputs.Any(p=>string.IsNullOrWhiteSpace(p.Key)||!double.IsFinite(p.Value)))throw new ArgumentException("Invalid normalized tracking sample");
        var copy=new Dictionary<string,double>(inputs);
        lock(gate){if(!enabled||id<=sequence)return false;sequence=id;pending=new(id,copy,clock());return true;}
    }
    public Dictionary<string,double>? Advance(ModelEvaluator evaluator)
    {
        string? load;Sample? sample;bool on,clear;int calibrate;TaskCompletionSource<string>? snapshot;
        lock(gate){snapshot=snapshotRequest;snapshotRequest=null;calibrate=calibration;calibration=0;load=profile;profile=null;sample=pending;pending=null;on=enabled;clear=reset;reset=false;}
        var next=State with{Enabled=on};
        bool preserveState=false;
        lock(gate){if(adjust&&(load??next.ProfileJson) is string current){preserveState=load==null;load=DefaultTracking.Adjust(current,gains,smoothing,eyeClosed);adjust=false;}}
        if(clear){lastAccepted=null;evaluator.ResetTracking();overlay=null;next=next with{Active=false};}
        if(load!=null){try{evaluator.LoadTrackingProfile(DefaultTracking.UpgradeProfile(load),preserveState);if(!preserveState){lastAccepted=null;overlay=null;next=next with{Active=false,Sequence=-1};}next=next with{Loaded=true,Error=null,ProfileJson=evaluator.ExportTrackingProfile()};}catch(Exception ex) when(ex is Microsoft.ClearScript.ScriptEngineException or ArgumentException){next=next with{Error=ex.Message};}}
        double now=clock();
        if(!on||overlay!=null&&now-acceptedAt>=.5){if(overlay!=null)evaluator.ResetTracking();overlay=null;next=next with{Active=false};}
        if(on&&next.Loaded&&sample!=null&&now-sample.Received<.5){
            try{
                var json=JsonSerializer.Serialize(new{timestampMs=sample.Received*1000,inputs=sample.Inputs});
                var mapped=JsonSerializer.Deserialize<Dictionary<string,double>>(evaluator.MapTracking(json))!;
                lastAccepted=sample;overlay=mapped;acceptedAt=sample.Received;next=next with{Active=mapped.Count>0,Sequence=sample.Sequence,Error=null};
            }catch(Exception ex) when(ex is Microsoft.ClearScript.ScriptEngineException or ArgumentException){next=next with{Error=ex.Message};}
        }
        if(calibrate!=0){
            try{
                if(!next.Loaded)throw new ArgumentException("先に設定を読み込んでください");
                if(calibrate==1&&(!on||lastAccepted==null||now-lastAccepted.Received>=.5))throw new ArgumentException("顔認識の新しい入力が必要です");
                evaluator.CalibrateTracking(calibrate==2?"null":JsonSerializer.Serialize(lastAccepted!.Inputs));
                overlay=null;lastAccepted=null;next=next with{Active=false,Error=null,ProfileJson=evaluator.ExportTrackingProfile()};
            }catch(Exception ex) when(ex is Microsoft.ClearScript.ScriptEngineException or ArgumentException){next=next with{Error=ex.Message};}
        }
        Volatile.Write(ref state,next);
        if(snapshot!=null){if(next.Error!=null||next.ProfileJson==null)snapshot.TrySetException(new InvalidOperationException(next.Error??"Tracking is not ready"));else snapshot.TrySetResult(next.ProfileJson);}
        return overlay;
    }
}
