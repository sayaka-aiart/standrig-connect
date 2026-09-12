using System.Text.Json;
namespace StandRig.Connect.Evaluation;

public sealed record MotionPlaybackState(string? Name,double Duration,double Time,bool Running,bool Active,string? Error)
{ public double Speed {get;init;}=1; public bool Loop {get;init;} }
public enum MotionAction { Load, Play, Pause, Stop, Seek, Configure }

/// <summary>Bounded UI commands; evaluation and playback clock stay on the model worker.</summary>
public sealed class MotionPlayback
{
    private readonly object gate=new();
    private sealed record Command(MotionAction Action,string? Json=null,double Time=0,double Speed=1,bool Loop=false);
    private readonly Queue<Command> pending=new();
    private MotionPlaybackState state=new(null,0,0,false,false,null);
    private double? previousTime;
    public MotionPlaybackState State=>Volatile.Read(ref state);
    public void Submit(MotionAction action,string? json=null)
    {
        if(!Enum.IsDefined(action)||action is MotionAction.Seek or MotionAction.Configure||action==MotionAction.Load&&(json==null||json.Length>4*1024*1024))throw new ArgumentException("Invalid motion command or file exceeds 4 MiB");
        Enqueue(new(action,json));
    }
    public void Seek(double time){if(!double.IsFinite(time)||time<0||time>3600)throw new ArgumentException("Invalid seek time");Enqueue(new(MotionAction.Seek,Time:time));}
    public void Configure(double speed,bool loop){if(!double.IsFinite(speed)||speed<.1||speed>4)throw new ArgumentException("Speed must be 0.1 to 4");Enqueue(new(MotionAction.Configure,Speed:speed,Loop:loop));}
    private void Enqueue(Command command){lock(gate){if(pending.Count>=8)throw new InvalidOperationException("Motion commands are busy; retry shortly");pending.Enqueue(command);}}
    public Dictionary<string,double>? Advance(ModelEvaluator evaluator,double seconds)
    {
        if(!double.IsFinite(seconds)||seconds<0||seconds>1e9||previousTime.HasValue&&seconds<previousTime.Value)throw new ArgumentException("Motion clock must be monotonic");
        var next=State;
        if(next.Running){double time=next.Time+(seconds-(previousTime??seconds))*next.Speed;next=next.Loop?next with{Time=time%next.Duration}:next with{Time=Math.Min(next.Duration,time),Running=time<next.Duration};}
        previousTime=seconds;
        Command[] commands;
        lock(gate){commands=pending.ToArray();pending.Clear();}
        foreach(var command in commands){
            try{
                switch(command.Action){
                    case MotionAction.Load:
                        using(var metadata=JsonDocument.Parse(evaluator.LoadMotion(command.Json!))){var root=metadata.RootElement;next=new(root.GetProperty("name").GetString(),root.GetProperty("duration").GetDouble(),0,false,false,null){Speed=next.Speed,Loop=next.Loop};}break;
                    case MotionAction.Play:
                        if(next.Name==null)throw new InvalidOperationException("先にモーションを読み込んでください");
                        next=next with{Time=next.Time>=next.Duration?0:next.Time,Running=true,Active=true,Error=null};break;
                    case MotionAction.Pause: next=next with{Running=false,Error=null};break;
                    case MotionAction.Stop: next=next with{Time=0,Running=false,Active=false,Error=null};break;
                    case MotionAction.Seek:
                        if(next.Name==null||command.Time>next.Duration)throw new ArgumentException("シーク位置がモーションの範囲外です");
                        next=next with{Time=command.Time,Active=true,Running=next.Running&&(next.Loop||command.Time<next.Duration),Error=null};break;
                    case MotionAction.Configure: next=next with{Speed=command.Speed,Loop=command.Loop,Error=null};break;
                }
            }catch(Exception ex) when(ex is Microsoft.ClearScript.ScriptEngineException or ArgumentException or InvalidOperationException or JsonException){next=next with{Error=ex.Message};}
        }
        Dictionary<string,double>? values=null;
        if(next.Active)values=JsonSerializer.Deserialize<Dictionary<string,double>>(evaluator.SampleMotion(next.Time));
        Volatile.Write(ref state,next);return values;
    }
}
