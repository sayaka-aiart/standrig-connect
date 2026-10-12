using System.Text.Json;
using StandRig.Connect.Evaluation;
internal static class FacialChecks
{
    public static void Run()
    {
        using var e=new ModelEvaluator();string source=File.ReadAllText(Path.Combine(AppContext.BaseDirectory,"facial-fixture.json"));
        e.Load(source);using var catalog=JsonDocument.Parse(e.FacialCatalog());if(catalog.RootElement.GetProperty("expressions").GetArrayLength()!=2)throw new Exception("Missing catalog");
        e.FacialCommand("{\"action\":\"expression\",\"id\":\"half\"}",0);
        double Value(double time,string id,string values="{}",string overrides="{}"){
            using var result=JsonDocument.Parse(e.Evaluate($"{{\"time\":{time.ToString(System.Globalization.CultureInfo.InvariantCulture)},\"values\":{values},\"overrides\":{overrides},\"physics\":false}}"));return result.RootElement.GetProperty("values").GetProperty(id).GetDouble();
        }
        if(Math.Abs(Value(.1,"ParamEyeLOpen","{\"ParamEyeLOpen\":0.8}")-.6)>1e-12)throw new Exception("V8 expression fade");
        if(Math.Abs(Value(.3,"ParamEyeLOpen","{\"ParamEyeLOpen\":0.8}")-.4)>1e-12||Value(.4,"ParamEyeLOpen","{\"ParamEyeLOpen\":0}")!=0)throw new Exception("V8 live blink");
        e.FacialCommand("{\"action\":\"visemes\",\"weights\":{\"A\":1,\"I\":1}}",.4);
        if(Value(.5,"ParamMouthOpen")!=.65||Value(.5,"ParamMouthOpen","{}","{\"ParamMouthOpen\":0.25}")!=.25)throw new Exception("V8 mouth mixture/manual priority");
        e.FacialCommand("{\"action\":\"clear\",\"layer\":\"viseme\"}",.5);
        if(Math.Abs(Value(.7,"ParamMouthOpen","{\"ParamMouthOpen\":0.8}")-.8)>1e-12||Math.Abs(Value(.7,"ParamEyeLOpen")-.5)>1e-12)throw new Exception("V8 selective clear/live base");
        string before=e.FacialState(.7);try{e.FacialCommand("{\"action\":\"expression\",\"id\":\"unknown\"}",.7);throw new Exception("V8 invalid accepted");}catch(Microsoft.ClearScript.ScriptEngineException){}
        if(before!=e.FacialState(.7))throw new Exception("V8 invalid changed state");
        e.Reset();if(Value(0,"ParamEyeLOpen")!=1)throw new Exception("V8 reset retains expression");
        e.FacialCommand("{\"action\":\"viseme\",\"id\":\"A\"}",0);e.Load(source);
        if(Value(0,"ParamMouthOpen")!=0)throw new Exception("V8 model reload retains vowel");
        var crossThread=Task.Run(()=>{try{e.FacialCommand("{\"action\":\"clear\"}",0);return false;}catch(InvalidOperationException){return true;}}).GetAwaiter().GetResult();if(!crossThread)throw new Exception("V8 wrong thread allowed");
        // Slots preserve the complete authored catalog but never bake transient facial values.
        string slotDirectory=Path.Combine(Path.GetTempPath(),"connect-facial-slot-"+Guid.NewGuid().ToString("N"));
        var slots=new ModelSlotStore(slotDirectory);
        using var meta=JsonDocument.Parse(e.Load(source));string profile=DefaultTracking.Create(meta.RootElement.GetProperty("parameters"));
        var controls=new TrackingControlsSnapshot(new(),.15,.55,true);
        var slot=slots.Save(null,"Facial test",new(1,source,profile,controls));
        var saved=new ModelSlotStore(slotDirectory).Load(slot.Id);if(saved.ModelJson!=source)throw new Exception("Slot altered facial catalog");
        e.FacialCommand("{\"action\":\"expression\",\"id\":\"half\"}",0);e.Load(saved.ModelJson);if(Value(0,"ParamEyeLOpen")!=1)throw new Exception("Slot retained transient face");
        // Preserve the unique temp slot as evidence; it contains synthetic parameter-only data.
        Console.WriteLine("PASS native V8 facial catalog, fades, live blink, mixture, manual priority, clear, reset/reload, invalid atomicity and thread ownership");
        Console.WriteLine("PASS facial slot catalog roundtrip without transient selection");
    }
}
