using System.Text.Json;
using StandRig.Connect;
using StandRig.Connect.Evaluation;
namespace StandRig.Connect.Desktop;

/// <summary>Evaluation-only milestone. It does not submit incomplete model geometry to the GPU.</summary>
internal sealed class ModelEvaluationPipeline : IFramePipeline
{
    private readonly ModelEvaluator evaluator = new();
    private readonly Dictionary<string,double> values = new();
    internal ModelEvaluationPipeline(string path, Action<string> loaded)
    {
        try
        {
            if(new FileInfo(path).Length>64L*1024*1024)throw new InvalidOperationException("Model exceeds 64 MiB evaluation limit");
            using var metadata=JsonDocument.Parse(evaluator.Load(File.ReadAllText(path)));
            foreach(var p in metadata.RootElement.GetProperty("parameters").EnumerateArray())values[p.GetProperty("id").GetString()!]=p.GetProperty("default").GetDouble();
            loaded($"評価中: {metadata.RootElement.GetProperty("name").GetString()} / {metadata.RootElement.GetProperty("parts").GetInt32()} parts（画像描画は未接続）");
        }
        catch { evaluator.Dispose(); throw; }
    }
    public void Step(double elapsedSeconds,PoseFrame? latestPose)
    {
        if(latestPose!=null)foreach(var entry in latestPose.Values)values[entry.Key]=entry.Value;
        evaluator.Tick(JsonSerializer.Serialize(new { time=elapsedSeconds, values, physics=true }));
    }
    public void Dispose()=>evaluator.Dispose();
}
