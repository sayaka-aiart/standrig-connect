using System.Text.Json;
using StandRig.Connect.Evaluation;

internal static class ParameterConventionChecks
{
    private const string LegacyRig = """
        {"schemaVersion":"0.1.0","name":"Convention test","stage":{"width":64,"height":64},
         "parameters":[],"assets":[],"parts":[],"physics":{"enabled":false,"chains":[]}}
        """;

    private static void Expect(JsonElement values, string id, double expected)
    {
        if (!values.TryGetProperty(id, out var value) || Math.Abs(value.GetDouble() - expected) > 1e-8)
            throw new Exception($"Expected {id} = {expected}; received {values}");
    }

    public static void Run()
    {
        using var evaluator = new ModelEvaluator();
        string cubismRig = LegacyRig.Insert(1, """ "metadata":{"parameterConvention":"cubism"}, """);
        string bundle = $$"""{"format":"standrig-bundle","version":1,"rig":{{cubismRig}}}""";
        using var cubism = JsonDocument.Parse(evaluator.Load(bundle));
        if (cubism.RootElement.GetProperty("parameterConvention").GetString() != "cubism")
            throw new Exception("Cubism convention was lost on load");
        string profile = DefaultTracking.CreateForModel(cubism.RootElement);
        var adjustment = new Dictionary<string, (double Gain, bool Invert)> { ["bodyPitch"] = (0.5, false) };
        evaluator.LoadTrackingProfile(DefaultTracking.Adjust(profile, adjustment, 0));
        const string input = """
            {"timestampMs":0,"inputs":{"facePitch":0.5,"bodyPitch":0.5,"eyeBallY":0.6,
              "eyeLOpen":0,"eyeROpen":1,"mouthOpen":0.8,"mouthSmile":0.7,"mouthForm":-0.5}}
            """;
        using (var mapped = JsonDocument.Parse(evaluator.MapTracking(input)))
        {
            var values = mapped.RootElement;
            Expect(values, "ParamAngleY", 15);
            Expect(values, "ParamBodyAngleY", 2.5);
            Expect(values, "ParamEyeBallY", 0.6);
            Expect(values, "ParamEyeLOpen", 0);
            Expect(values, "ParamEyeROpen", 1);
            Expect(values, "ParamMouthOpenY", 0.8);
            Expect(values, "ParamMouthForm", 0.7);
            Expect(values, "ParamMouthRound", -0.5);
            if (values.TryGetProperty("ParamMouthOpen", out _))
                throw new Exception("Cubism mapping emitted the legacy mouth ID");
        }
        string saved = evaluator.ExportTrackingProfile();
        using (var savedProfile = JsonDocument.Parse(saved))
            if (savedProfile.RootElement.GetProperty("name").GetString() != DefaultTracking.CubismProfileName)
                throw new Exception("Cubism profile identity was lost");
        using var legacy = JsonDocument.Parse(evaluator.Load(LegacyRig));
        evaluator.LoadTrackingProfile(DefaultTracking.Adjust(DefaultTracking.CreateForModel(legacy.RootElement), new Dictionary<string, (double Gain, bool Invert)>(), 0));
        using (var mapped = JsonDocument.Parse(evaluator.MapTracking(input)))
        {
            var values = mapped.RootElement;
            Expect(values, "ParamMouthOpen", 0.8);
            Expect(values, "ParamMouthForm", -0.5);
            Expect(values, "ParamEyeLOpen", 1);
            Expect(values, "ParamEyeROpen", 0);
        }
        Console.WriteLine("PASS Cubism model tracking, mouth channels, eyelids, gains and legacy profile defaults");
    }
}
