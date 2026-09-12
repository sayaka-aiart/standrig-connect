using System.Reflection;
using System.Text.Json;
using Microsoft.ClearScript.V8;
using Microsoft.ClearScript.JavaScript;
namespace StandRig.Connect.Evaluation;
public sealed record RenderFrame(string Metadata,float[] Vertices,uint[] Indices);

/// <summary>Owns an embedded V8 evaluator on its creating thread; exposes no .NET host objects to model data.</summary>
public sealed class ModelEvaluator : IDisposable
{
    private readonly V8ScriptEngine engine;
    private readonly int owner = Environment.CurrentManagedThreadId;
    private bool disposed;
    public ModelEvaluator()
    {
        engine = new V8ScriptEngine();
        try
        {
            using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("StandRig.Evaluator.js") ?? throw new InvalidOperationException("Missing evaluator bundle");
            using var reader = new StreamReader(stream);
            engine.Execute(reader.ReadToEnd());
        }
        catch { engine.Dispose(); throw; }
    }
    private void CheckThread()
    {
        ObjectDisposedException.ThrowIf(disposed,this);
        if (Environment.CurrentManagedThreadId != owner) throw new InvalidOperationException("Evaluator must stay on its owning thread");
    }
    public string Load(string modelJson)
    {
        CheckThread();
        if (modelJson.Length > 64 * 1024 * 1024) throw new ArgumentException("Model exceeds evaluation input limit");
        string result=(string)engine.Script.StandRigEvaluation.load(modelJson);
        engine.Script.StandRigEvaluation.clearEffects();return result;
    }
    public string Evaluate(string requestJson)
    {
        CheckThread();
        if(requestJson.Length>1024*1024)throw new ArgumentException("Evaluation request too large");
        return (string)engine.Script.StandRigEvaluation.evaluate(requestJson);
    }
    public string Tick(string requestJson)
    {
        CheckThread();
        if(requestJson.Length>1024*1024)throw new ArgumentException("Evaluation request too large");
        return (string)engine.Script.StandRigEvaluation.tick(requestJson);
    }
    public string Snapshot() { CheckThread(); return (string)engine.Script.StandRigEvaluation.snapshot(); }
    public string LoadMotion(string json){CheckThread();if(json.Length>4*1024*1024)throw new ArgumentException("Motion exceeds 4 MiB limit");return (string)engine.Script.StandRigEvaluation.loadMotion(json);}
    public string SampleMotion(double seconds){CheckThread();return (string)engine.Script.StandRigEvaluation.motionValues(seconds);}
    public string LoadTrackingProfile(string json,bool preserveState=false){CheckThread();if(json.Length>1024*1024)throw new ArgumentException("Tracking profile exceeds 1 MiB");return (string)engine.Script.StandRigEvaluation.loadTrackingProfile(json,preserveState);}
    public string MapTracking(string json){CheckThread();if(json.Length>64*1024)throw new ArgumentException("Tracking input exceeds 64 KiB");return (string)engine.Script.StandRigEvaluation.mapTracking(json);}
    public string ExportTrackingProfile(){CheckThread();return (string)engine.Script.StandRigEvaluation.exportTrackingProfile();}
    public void CalibrateTracking(string json){CheckThread();if(json.Length>64*1024)throw new ArgumentException("Calibration input exceeds 64 KiB");engine.Script.StandRigEvaluation.calibrateTracking(json);}
    public void ResetTracking(){CheckThread();engine.Script.StandRigEvaluation.resetTracking();}
    public string ConvertFace(string json){CheckThread();if(json.Length>64*1024)throw new ArgumentException("Face result exceeds 64 KiB");return (string)engine.Script.StandRigEvaluation.convertFace(json);}
    public string Profile(){CheckThread();return (string)engine.Script.StandRigEvaluation.profile();}
    public RenderFrame Render(string requestJson){
        CheckThread();if(requestJson.Length>1024*1024)throw new ArgumentException("Render request too large");
        string metadata=(string)engine.Script.StandRigEvaluation.renderPacket(requestJson);
        var vertices=(ITypedArray<float>)engine.Script.StandRigEvaluation.renderVertices();
        var indices=(ITypedArray<uint>)engine.Script.StandRigEvaluation.renderIndices();
        return new RenderFrame(metadata,vertices.ToArray(),indices.ToArray());
    }
    /// <summary>Copies into caller-owned reusable arrays. Contents are replaced on each call;
    /// use Render when retaining independent frame snapshots. Arrays have exact valid lengths.</summary>
    public string RenderInto(string requestJson,ref float[] vertexBuffer,ref uint[] indexBuffer){
        CheckThread();if(requestJson.Length>1024*1024)throw new ArgumentException("Render request too large");
        string metadata=(string)engine.Script.StandRigEvaluation.renderPacket(requestJson);
        var vertices=(ITypedArray<float>)engine.Script.StandRigEvaluation.renderVertices();
        var indices=(ITypedArray<uint>)engine.Script.StandRigEvaluation.renderIndices();
        int vertexLength=checked((int)vertices.Length),indexLength=checked((int)indices.Length);
        if(vertexBuffer.Length!=vertexLength)vertexBuffer=new float[vertexLength];
        if(indexBuffer.Length!=indexLength)indexBuffer=new uint[indexLength];
        if(vertices.Read(0,vertices.Length,vertexBuffer,0)!=vertices.Length||indices.Read(0,indices.Length,indexBuffer,0)!=indices.Length)throw new InvalidOperationException("Incomplete render buffer copy");
        return metadata;
    }
    public void RegisterEffect(string id,int width,int height,byte[] rgba,string configJson)
    {
        CheckThread();
        if(width<=0||height<=0||width>4096||height>4096||rgba.Length!=(long)width*height*4||configJson.Length>1024*1024)throw new ArgumentException("Invalid image effect input");
        var buffer=(ITypedArray<byte>)engine.Script.StandRigEvaluation.effectBuffer(rgba.Length);
        buffer.Write(rgba,0,(ulong)rgba.Length,0);
        engine.Script.StandRigEvaluation.registerEffect(id,width,height,buffer,configJson);
    }
    public byte[]? RenderEffect(string id,string valuesJson,bool ignoreVisualAlpha)
    {
        CheckThread();if(valuesJson.Length>1024*1024)throw new ArgumentException("Effect request too large");
        object? result=engine.Script.StandRigEvaluation.renderEffect(id,valuesJson,ignoreVisualAlpha);
        return result is null?null:result is ITypedArray<byte> data?data.ToArray():throw new InvalidOperationException("Unexpected image effect result");
    }
    public void Reset() { CheckThread(); engine.Script.StandRigEvaluation.reset(); }
    public void Dispose() { if(disposed)return;CheckThread();engine.Dispose();disposed=true; }
}
