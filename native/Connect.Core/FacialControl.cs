using System.Text.Json;
namespace StandRig.Connect;

public sealed class FacialBusyException(string message):Exception(message);
public sealed record FacialSnapshot(string? ModelSession,JsonElement? Presets,JsonElement? State,long AcceptedSequence,long AppliedSequence,int Pending,string? Error);

// Only the renderer executes commands. HTTP/UI validate and enqueue immutable JSON.
public sealed class FacialControl
{
    private readonly object gate=new();
    private readonly Queue<(long Sequence,string Json)> pending=new();
    private string? session;
    private JsonElement? presets,state;
    private HashSet<string> expressions=new(),visemes=new();
    private long accepted,applied;
    private double publishedAt=double.NegativeInfinity;
    private string? error;
    public void Load(string modelSession,string validatedCatalog)
    {
        using var doc=JsonDocument.Parse(validatedCatalog);
        var catalog=doc.RootElement.Clone();
        var expressionIds=catalog.GetProperty("expressions").EnumerateArray().Select(p=>p.GetProperty("id").GetString()!).ToHashSet();
        var visemeIds=catalog.TryGetProperty("visemes",out var bank)?bank.GetProperty("presets").EnumerateArray().Select(p=>p.GetProperty("id").GetString()!).ToHashSet():new HashSet<string>();
        lock(gate){session=modelSession;presets=catalog;state=null;expressions=expressionIds;visemes=visemeIds;pending.Clear();accepted=applied=0;error=null;publishedAt=double.NegativeInfinity;}
    }
    public void Unload(string? modelSession){lock(gate){if(session!=modelSession)return;session=null;presets=state=null;expressions.Clear();visemes.Clear();pending.Clear();accepted=applied=0;error=null;publishedAt=double.NegativeInfinity;}}
    private void Require(string modelSession){if(session==null||session!=modelSession)throw new ParameterSessionException("Model session changed or no model loaded");}
    private static void Fields(JsonElement value,params string[] allowed)
    {
        if(value.ValueKind!=JsonValueKind.Object)throw new ArgumentException("Expected object");
        var seen=new HashSet<string>();foreach(var p in value.EnumerateObject())if(!allowed.Contains(p.Name)||!seen.Add(p.Name))throw new ArgumentException("Unknown or duplicate facial field: "+p.Name);
    }
    private static void Strength(JsonElement value){if(value.ValueKind!=JsonValueKind.Number||!value.TryGetDouble(out var v)||!double.IsFinite(v)||v<0||v>1)throw new ArgumentException("Facial strength/weight must be a finite number in [0,1]");}
    public long Submit(string modelSession,string commandJson)
    {
        if(System.Text.Encoding.UTF8.GetByteCount(commandJson)>32768)throw new ArgumentException("Facial command exceeds 32 KiB");
        using var doc=JsonDocument.Parse(commandJson,new JsonDocumentOptions{MaxDepth=8});var root=doc.RootElement;
        lock(gate){Require(modelSession);
            if(root.ValueKind!=JsonValueKind.Object)throw new ArgumentException("Expected facial command object");
            var action=root.GetProperty("action").GetString();
            switch(action){
                case "expression": case "viseme":
                    Fields(root,"action","id","strength");
                    string id=root.GetProperty("id").GetString()??throw new ArgumentException("id required");
                    if(!(action=="expression"?expressions:visemes).Contains(id))throw new ArgumentException("Unregistered facial ID: "+id);
                    if(root.TryGetProperty("strength",out var strength))Strength(strength);break;
                case "visemes":
                    Fields(root,"action","weights");if(visemes.Count==0)throw new ArgumentException("No registered viseme bank");
                    var weights=root.GetProperty("weights");Fields(weights,visemes.ToArray());foreach(var p in weights.EnumerateObject())Strength(p.Value);break;
                case "clear":
                    Fields(root,"action","layer","immediate");
                    if(root.TryGetProperty("layer",out var layer)&&layer.GetString() is not ("all" or "expression" or "viseme"))throw new ArgumentException("Invalid facial layer");
                    if(root.TryGetProperty("immediate",out var immediate)&&immediate.ValueKind is not (JsonValueKind.True or JsonValueKind.False))throw new ArgumentException("immediate must be boolean");break;
                default:throw new ArgumentException("Unknown facial action");
            }
            if(pending.Count>=32)throw new FacialBusyException("Facial command queue is full; retry after the renderer advances");
            long sequence=++accepted;pending.Enqueue((sequence,root.GetRawText()));return sequence;
        }
    }
    public FacialSnapshot Snapshot(){lock(gate)return new(session,presets,state,accepted,applied,pending.Count,error);}
    // Called solely on the evaluator's owning thread. One model-scoped queue for UI and HTTP.
    public void Advance(string modelSession,double seconds,Func<string,double,string> command,Func<double,string> snapshot)
    {
        lock(gate){if(session!=modelSession)return;
            bool changed=pending.Count>0;
            while(pending.TryDequeue(out var next)){
                try{using var result=JsonDocument.Parse(command(next.Json,seconds));state=result.RootElement.Clone();applied=next.Sequence;error=null;}
                catch(Exception e){error="Command "+next.Sequence+": "+e.Message;}
            }
            if(changed||seconds-publishedAt>=.1){using var current=JsonDocument.Parse(snapshot(seconds));state=current.RootElement.Clone();publishedAt=seconds;}
        }
    }
}
