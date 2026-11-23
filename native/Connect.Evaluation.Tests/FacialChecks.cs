using System.Text.Json;
using System.Text.Json.Nodes;
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
        CubismMouthPad(e);
        MotionSyncMouth(e, source);
    }

    private static void MotionSyncMouth(ModelEvaluator evaluator, string source)
    {
        // The persisted model retains its manual A shape while playback uses the selected profile.
        var rig = JsonNode.Parse(source)!.AsObject();
        var facial = rig["facialPresets"]!.AsObject();
        var manual = facial["visemes"]!.DeepClone();
        string[] ids = ["Silence", "A", "I", "U", "E", "O"];
        double[] openings = [0, .72, .28, .36, .63, .85];
        facial["motionSync"] = JsonSerializer.SerializeToNode(new
        {
            selectedId = "cubism-mouth",
            profiles = new[] {
                new {
                    id = "cubism-mouth", name = "MotionSync",
                    setting = new {
                        Id = "MotionSyncSetting", AnalysisType = "CRI", UseCase = "Mouth",
                        CubismParameters = new[] {
                            new { Id = "ParamMouthOpenY", Name = "Mouth", Min = 0, Max = 1, Damper = 0, Smooth = 25 },
                            new { Id = "ParamMouthForm", Name = "Form", Min = -1, Max = 1, Damper = 0, Smooth = 25 }
                        },
                        AudioParameters = ids.Select(id => new { Id = id, Name = id, Min = 0, Max = 1, Scale = 2, Enabled = true }),
                        Mappings = ids.Select((id, i) => new {
                            Type = "Shape", Id = id, Targets = new[] {
                                new { Id = "ParamMouthOpenY", Value = openings[i] },
                                new { Id = "ParamMouthForm", Value = -.1 * i }
                            }
                        }),
                        PostProcessing = new { BlendRatio = .5, Smoothing = 60, SampleRate = 60 }
                    }
                }
            }
        });
        var bundle = new JsonObject { ["format"] = "standrig-bundle", ["version"] = 1, ["name"] = "MotionSync mouth", ["rig"] = rig };
        evaluator.Load(bundle.ToJsonString());
        using var catalog = JsonDocument.Parse(evaluator.FacialCatalog());
        var poses = catalog.RootElement.GetProperty("visemes").GetProperty("presets");
        if (poses.GetArrayLength() != 6 || poses[1].GetProperty("values").GetProperty("ParamMouthOpen").GetDouble() != .72)
            throw new Exception("Connect did not discover the selected MotionSync mouth bank");

        double Evaluate(string request, double start, double time)
        {
            evaluator.FacialCommand(request, start);
            using var frame = JsonDocument.Parse(evaluator.Evaluate(JsonSerializer.Serialize(new { time, physics = false })));
            return frame.RootElement.GetProperty("values").GetProperty("ParamMouthOpen").GetDouble();
        }
        if (Evaluate("""{"action":"viseme","id":"A"}""", 0, .1) != .72)
            throw new Exception("Connect manual preview did not use imported A");
        if (Math.Abs(Evaluate("""{"action":"visemes","weights":{"A":0.5,"I":0.5}}""", .1, .2) - .5) > 1e-12)
            throw new Exception("Connect audio mixture did not use imported A and I");

        facial["motionSync"]!.AsObject().Remove("selectedId");
        evaluator.Load(bundle.ToJsonString());
        using var fallback = JsonDocument.Parse(evaluator.FacialCatalog());
        if (!JsonNode.DeepEquals(JsonNode.Parse(fallback.RootElement.GetProperty("visemes").GetRawText()), manual))
            throw new Exception("Connect did not restore the original manual bank");
        Console.WriteLine("PASS MotionSync bundle selection, imported manual and weighted playback, and original registrations");
    }

    private static void CubismMouthPad(ModelEvaluator evaluator)
    {
        // A and E use model-authored values, including an axis outside the XY pad.
        const string bundle = """
            {"format":"standrig-bundle","version":1,"name":"Mouth pad",
             "rig":{"schemaVersion":"0.1.0","name":"Mouth pad","stage":{"width":64,"height":64},
              "metadata":{"parameterConvention":"cubism"},"parameters":[],"assets":[],"parts":[],
              "physics":{"enabled":false,"chains":[]},
              "facialPresets":{"version":1,"expressions":[],"visemes":{"mode":"pose","fadeInTime":0,"fadeOutTime":0,
               "presets":[
                {"id":"A","values":{"ParamMouthForm":0.23,"ParamMouthOpenY":0.78,"ParamMouthRound":0.42}},
                {"id":"E","values":{"ParamMouthForm":0.48,"ParamMouthOpenY":0.63,"ParamMouthRound":-0.3}}
               ]}}}}
            """;
        evaluator.Load(bundle);
        using var catalog = JsonDocument.Parse(evaluator.FacialCatalog());
        using var authored = JsonDocument.Parse(bundle);
        var poses = catalog.RootElement.GetProperty("visemes").GetProperty("presets");
        var original = authored.RootElement.GetProperty("rig").GetProperty("facialPresets").GetProperty("visemes").GetProperty("presets");
        if (poses.GetArrayLength() != original.GetArrayLength()) throw new Exception("Model vowel catalog changed on import");
        for (int i = 0; i < poses.GetArrayLength(); i++)
        {
            var pose = poses[i];
            string id = pose.GetProperty("id").GetString()!;
            var expected = original[i].GetProperty("values");
            foreach (string command in new[] {
                JsonSerializer.Serialize(new { action = "viseme", id }),
                JsonSerializer.Serialize(new { action = "visemes", weights = new Dictionary<string, double> { [id] = 1 } })
            })
            {
                evaluator.FacialCommand("{\"action\":\"clear\",\"layer\":\"viseme\",\"immediate\":true}", i);
                evaluator.FacialCommand(command, i);
                using var frame = JsonDocument.Parse(evaluator.Evaluate(
                    $"{{\"time\":{i},\"values\":{{\"ParamMouthForm\":-1,\"ParamMouthOpenY\":0,\"ParamMouthRound\":1}},\"physics\":false}}"));
                var values = frame.RootElement.GetProperty("values");
                foreach (var channel in expected.EnumerateObject())
                    if (Math.Abs(values.GetProperty(channel.Name).GetDouble() - channel.Value.GetDouble()) > 1e-12)
                        throw new Exception($"Model vowel {id} lost {channel.Name}");
            }
        }
        Console.WriteLine("PASS saved Cubism mouth-pad poses used by manual and weighted audio commands");
    }
}
