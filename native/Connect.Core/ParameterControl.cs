using System.Diagnostics;
namespace StandRig.Connect;

public sealed class ParameterSessionException(string message) : Exception(message);

public sealed record ParameterDefinition(string Id,double Min,double Max,double Default);
public sealed record ParameterSnapshot(string? ModelSession,ParameterDefinition[] Parameters,Dictionary<string,double> InputValues,Dictionary<string,double> Overrides);

// One process-local controller. No writes to the model or tracking configuration.
public sealed class ParameterControl
{
    private readonly object gate=new();
    private readonly Func<double> now;
    private string? session;
    private Dictionary<string,ParameterDefinition> definitions=new();
    private Dictionary<string,double> values=new();
    private readonly Dictionary<string,(double Value,double Until)> overrides=new();
    public ParameterControl(Func<double>? clock=null)=>now=clock??(()=>Stopwatch.GetTimestamp()/(double)Stopwatch.Frequency);
    public string Load(IEnumerable<ParameterDefinition> parameters)
    {
        var next=parameters.ToDictionary(p=>p.Id);
        if(next.Values.Any(p=>string.IsNullOrWhiteSpace(p.Id)||!double.IsFinite(p.Min)||!double.IsFinite(p.Max)||!double.IsFinite(p.Default)||p.Min>p.Max||p.Default<p.Min||p.Default>p.Max))throw new ArgumentException("Invalid parameter definitions");
        lock(gate){definitions=next;values=next.ToDictionary(p=>p.Key,p=>p.Value.Default);overrides.Clear();return session=Guid.NewGuid().ToString("N");}
    }
    public void Unload(string? modelSession){lock(gate){if(session!=modelSession)return;session=null;definitions.Clear();values.Clear();overrides.Clear();}}
    private void Require(string modelSession){if(session==null||session!=modelSession)throw new ParameterSessionException("Model session changed or no model loaded");}
    private void Expire(){double time=now();foreach(var id in overrides.Where(p=>p.Value.Until<=time).Select(p=>p.Key).ToArray())overrides.Remove(id);}
    public void Set(string modelSession,IReadOnlyDictionary<string,double> changes,int ttlMs=1000)
    {
        if(ttlMs<100||ttlMs>10000||changes.Count==0||changes.Count>512)throw new ArgumentException("ttlMs must be 100..10000; values must contain 1..512 items");
        lock(gate){Require(modelSession);
            foreach(var p in changes)if(!definitions.TryGetValue(p.Key,out var d)||!double.IsFinite(p.Value)||p.Value<d.Min||p.Value>d.Max)throw new ArgumentException("Unknown parameter or value outside range: "+p.Key);
            double until=now()+ttlMs/1000d;foreach(var p in changes)overrides[p.Key]=(p.Value,until);
        }
    }
    public void Clear(string modelSession,IReadOnlyList<string>? ids=null)
    {
        lock(gate){Require(modelSession);if(ids==null){overrides.Clear();return;}
            if(ids.Count>512||ids.Any(id=>!definitions.ContainsKey(id)))throw new ArgumentException("Unknown parameter");
            foreach(var id in ids)overrides.Remove(id);
        }
    }
    // Values represent the most recently submitted renderer input, before physics.
    public Dictionary<string,double> Apply(string modelSession,Dictionary<string,double> input)
    {
        lock(gate){if(session!=modelSession)return input;Expire();
            var result=overrides.Count==0?input:new Dictionary<string,double>(input);
            foreach(var p in overrides)result[p.Key]=p.Value.Value;
            foreach(var id in definitions.Keys)if(result.TryGetValue(id,out var value))values[id]=value;
            return result;
        }
    }
    public ParameterSnapshot Snapshot(){lock(gate){Expire();return new(session,definitions.Values.ToArray(),new(values),overrides.ToDictionary(p=>p.Key,p=>p.Value.Value));}}
}
