using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Diagnostics;
using StandRig.Connect;
using StandRig.Connect.Evaluation;
namespace StandRig.Connect.Desktop;

// Native renderer: embedded PNG, ArtMesh/image grids, grouped alpha masks, normal premultiplied source-over.
internal sealed class ModelRenderPipeline : IFramePipeline
{
    private readonly ModelEvaluator evaluator = new();
    private readonly Dictionary<string,double> values = new();
    private readonly Dictionary<string,uint> textures = new();
    private readonly Dictionary<string,(uint Normal,uint Mask)> effectTextures = new();
    private string effectiveValues="{}";
    private readonly Func<bool> present;
    private readonly string? capture;
    private readonly bool physicsEnabled;
    private readonly bool benchmarkMotion;
    private readonly Func<bool>? demoEnabled;
    private readonly MotionPlayback? motion;
    private readonly Func<IdlePreset>? idlePreset;
    private readonly IdlePose idlePose=new();
    private readonly bool breathBound;
    private readonly ParameterControl? parameterControl;
    private string? parameterSession;
    private readonly TrackingPlayback? tracking;
    private readonly Dictionary<string,(double Min,double Max)> ranges=new();
    private readonly Queue<double> recentCpu=new();
    private object matrix;
    private readonly Func<OutputView>? outputView;
    private OutputView view=new();
    private double stageWidth,stageHeight;
    private nint device;
    private int frames;
    private long measured,managedBytes;
    private double evaluationMs,parseMs,drawMs,prepareMs,effectMs;
    private double framePrepareMs,frameEffectMs;
    private float[] renderVertices=Array.Empty<float>();
    private uint[] renderIndices=Array.Empty<uint>();
    private Vertex[] drawVertices=Array.Empty<Vertex>();
    private uint[] drawIndices=Array.Empty<uint>();
    internal static object? Timings;
    internal static long RenderedFrames;
    internal static int SpoutResult=1;
    internal static SendStatistics SpoutStatistics=new();
    private readonly Func<bool>? spoutEnabled;
    internal static int NonTransparentPixels;
    [StructLayout(LayoutKind.Sequential)] private struct Vertex { public float X,Y,U,V,Opacity; }
    [StructLayout(LayoutKind.Sequential)] private struct PathStamp { public float X,Y,RadiusX,RadiusY,R,G,B,A; }
    internal ModelRenderPipeline(string path,nint window,Func<bool> present,Action<string> loaded,string? capture=null,bool physicsEnabled=true,bool benchmarkMotion=false,Func<bool>? demoEnabled=null,MotionPlayback? motion=null,TrackingPlayback? tracking=null,Func<bool>? spoutEnabled=null,bool autoTracking=false,string? modelJson=null,string? initialTrackingProfile=null,Action<string>? modelReady=null,Func<IdlePreset>? idlePreset=null,ParameterControl? parameterControl=null,Func<OutputView>? outputView=null)
    {
        Volatile.Write(ref SpoutStatistics,new SendStatistics());Volatile.Write(ref SpoutResult,1);
        this.outputView=outputView;this.parameterControl=parameterControl;this.idlePreset=idlePreset;this.spoutEnabled=spoutEnabled;this.present=present;this.capture=capture;this.physicsEnabled=physicsEnabled;this.benchmarkMotion=benchmarkMotion;this.demoEnabled=demoEnabled;this.motion=motion;this.tracking=tracking;
        try
        {
            if(modelJson==null&&new FileInfo(path).Length>64L*1024*1024)throw new InvalidOperationException("Model exceeds 64 MiB limit");
            var json=modelJson??File.ReadAllText(path);if(System.Text.Encoding.UTF8.GetByteCount(json)>64L*1024*1024)throw new InvalidOperationException("Model exceeds 64 MiB limit");using var model=JsonDocument.Parse(json);
            static bool ReferencesBreath(JsonElement element){
                if(element.ValueKind==JsonValueKind.String)return element.GetString()=="ParamBreath";
                if(element.ValueKind==JsonValueKind.Array)return element.EnumerateArray().Any(ReferencesBreath);
                if(element.ValueKind==JsonValueKind.Object)return element.EnumerateObject().Any(p=>p.Name is not ("name" or "label" or "id" or "metadata")&&ReferencesBreath(p.Value));
                return false;
            }
            breathBound=new[]{"parts","deformers"}.Any(key=>model.RootElement.TryGetProperty(key,out var group)&&ReferencesBreath(group));
            var reasons=new List<string>();
            foreach(var part in model.RootElement.GetProperty("parts").EnumerateArray())
            {
                string id=part.GetProperty("id").GetString()!;
                if(part.TryGetProperty("blendMode",out var blend)&&blend.ValueKind!=JsonValueKind.Null&&!new[]{"normal","multiply","screen","additive"}.Contains(blend.GetString()))reasons.Add(id+": blendMode");
            }
            if(reasons.Count>0)throw new NotSupportedException("Native renderer unsupported features: "+string.Join(", ",reasons.Take(12)));
            using var metadata=JsonDocument.Parse(evaluator.Load(json));
            if(initialTrackingProfile!=null)tracking?.LoadProfile(initialTrackingProfile);else if(autoTracking)tracking?.LoadProfile(DefaultTracking.Create(metadata.RootElement.GetProperty("parameters")));
            foreach(var p in metadata.RootElement.GetProperty("parameters").EnumerateArray())values[p.GetProperty("id").GetString()!]=p.GetProperty("default").GetDouble();
            foreach(var p in metadata.RootElement.GetProperty("parameters").EnumerateArray())ranges[p.GetProperty("id").GetString()!]=(p.GetProperty("min").GetDouble(),p.GetProperty("max").GetDouble());
            var stage=metadata.RootElement.GetProperty("stage");double w=stage.GetProperty("width").GetDouble(),h=stage.GetProperty("height").GetDouble();
            stageWidth=w;stageHeight=h;view=outputView?.Invoke()??new();view.Validate();matrix=view.Matrix(w,h);
            using var initial=JsonDocument.Parse(evaluator.Evaluate(JsonSerializer.Serialize(new{time=0,values,matrix,physics=true})));
            var geometry=initial.RootElement.GetProperty("geometry");
            if(geometry.GetProperty("unsupported").GetArrayLength()>0)throw new NotSupportedException("Native renderer cannot resolve geometry: "+geometry.GetProperty("unsupported").GetRawText());
            var required=geometry.GetProperty("meshes").EnumerateArray().Select(m=>m.GetProperty("assetId").GetString()!).ToHashSet();
            if(required.Count==0)throw new NotSupportedException("No image meshes to render");
            Marshal.ThrowExceptionForHR(ConnectCreate(window,(uint)view.Width,(uint)view.Height,out device));
            long textureBytes=0;
            long effectPixels=0;
            var effectParts=model.RootElement.GetProperty("parts").EnumerateArray().Where(p=>new[]{"tint","alphaReveal","contourShade"}.Any(key=>p.TryGetProperty(key,out var v)&&v.ValueKind!=JsonValueKind.Null)).ToArray();
            foreach(var asset in model.RootElement.GetProperty("assets").EnumerateArray())
            {
                string id=asset.GetProperty("id").GetString()!;if(!required.Contains(id))continue;
                if(textures.ContainsKey(id))throw new InvalidOperationException("Duplicate asset: "+id);
                string src=asset.GetProperty("src").GetString()??"";
                const string prefix="data:image/png;base64,";
                if(!src.StartsWith(prefix,StringComparison.Ordinal))throw new NotSupportedException("Embed PNG asset before native rendering: "+id);
                int width=asset.GetProperty("width").GetInt32(),height=asset.GetProperty("height").GetInt32();
                if(width<=0||height<=0||width>4096||height>4096||(textureBytes+=(long)width*height*4)>256L*1024*1024)throw new InvalidOperationException("Texture size/budget exceeded");
                using var stream=new MemoryStream(Convert.FromBase64String(src[prefix.Length..]));
                using var source=Image.FromStream(stream,true,true);
                if(source.Width!=width||source.Height!=height)throw new InvalidOperationException("Asset dimensions disagree: "+id);
                using var bitmap=new Bitmap(width,height,PixelFormat.Format32bppArgb);
                using(var g=Graphics.FromImage(bitmap)){g.CompositingMode=System.Drawing.Drawing2D.CompositingMode.SourceCopy;g.DrawImage(source,new Rectangle(0,0,width,height));}
                var straight=ReadBitmap(bitmap);var bytes=new byte[straight.Length];var rgba=new byte[straight.Length];
                for(int i=0;i<bytes.Length;i+=4){byte a=straight[i+3];for(int c=0;c<3;c++)bytes[i+c]=(byte)Math.Round(straight[i+c]*a/255d,MidpointRounding.AwayFromZero);bytes[i+3]=a;rgba[i]=straight[i+2];rgba[i+1]=straight[i+1];rgba[i+2]=straight[i];rgba[i+3]=a;}
                Marshal.ThrowExceptionForHR(ConnectUploadTexture(device,(uint)width,(uint)height,bytes,(uint)bytes.Length,out uint texture));textures.Add(id,texture);
                foreach(var part in effectParts.Where(p=>p.TryGetProperty("assetId",out var a)&&a.GetString()==id)){
                    if((effectPixels+=(long)width*height)>1_000_000||(textureBytes+=(long)bytes.Length*2)>256L*1024*1024)throw new NotSupportedException("Image effect development budget exceeded (1 million part pixels)");
                    string partId=part.GetProperty("id").GetString()!;evaluator.RegisterEffect(partId,width,height,rgba,part.GetRawText());
                    Marshal.ThrowExceptionForHR(ConnectUploadTexture(device,(uint)width,(uint)height,bytes,(uint)bytes.Length,out uint normal));
                    Marshal.ThrowExceptionForHR(ConnectUploadTexture(device,(uint)width,(uint)height,bytes,(uint)bytes.Length,out uint mask));effectTextures.Add(partId,(normal,mask));
                }
            }
            if(required.Any(id=>!textures.ContainsKey(id)))throw new InvalidOperationException("Missing texture");
            evaluator.Reset();
            parameterSession=parameterControl?.Load(metadata.RootElement.GetProperty("parameters").EnumerateArray().Select(p=>new ParameterDefinition(p.GetProperty("id").GetString()!,p.GetProperty("min").GetDouble(),p.GetProperty("max").GetDouble(),p.GetProperty("default").GetDouble())));
            modelReady?.Invoke(json);loaded("D3Dモデル描画中: "+metadata.RootElement.GetProperty("name").GetString()+"（通常合成・画像・マスク）");
        }
        catch {Dispose();throw;}
    }
    public void Step(double elapsedSeconds,PoseFrame? latestPose)
    {
        var requested=outputView?.Invoke()??view;
        if(requested!=view){requested.Validate();if(requested.Width!=view.Width||requested.Height!=view.Height)Marshal.ThrowExceptionForHR(ConnectResize(device,(uint)requested.Width,(uint)requested.Height));view=requested;matrix=view.Matrix(stageWidth,stageHeight);}
        long allocationStart=GC.GetAllocatedBytesForCurrentThread();var clock=Stopwatch.StartNew();framePrepareMs=frameEffectMs=0;
        if(latestPose!=null)foreach(var item in latestPose.Values)values[item.Key]=item.Value;
        bool demoActive=benchmarkMotion||demoEnabled?.Invoke()==true;
        var activeValues=demoActive?DemoPose.Apply(values,ranges,elapsedSeconds):new Dictionary<string,double>(values);
        var trackingValues=tracking?.Advance(evaluator);
        if(trackingValues!=null){activeValues=new Dictionary<string,double>(activeValues);foreach(var pair in trackingValues)activeValues[pair.Key]=pair.Value;}
        if(!demoActive)activeValues=idlePose.Apply(activeValues,ranges,elapsedSeconds,idlePreset?.Invoke()??IdlePreset.Off,breathBound);
        matrix=view.Matrix(stageWidth,stageHeight,demoActive?0:idlePose.BreathingStretch);
        var motionValues=motion?.Advance(evaluator,elapsedSeconds);
        if(motionValues!=null){activeValues=new Dictionary<string,double>(activeValues);foreach(var pair in motionValues)activeValues[pair.Key]=pair.Value;}

        if(parameterSession!=null)activeValues=parameterControl!.Apply(parameterSession,activeValues);
        var metadata=evaluator.RenderInto(JsonSerializer.Serialize(new{time=elapsedSeconds,values=activeValues,matrix,physics=physicsEnabled}),ref renderVertices,ref renderIndices);double evaluated=clock.Elapsed.TotalMilliseconds;
        using var packet=JsonDocument.Parse(metadata);double parsed=clock.Elapsed.TotalMilliseconds;
        var geometry=packet.RootElement.GetProperty("geometry");
        effectiveValues=packet.RootElement.GetProperty("values").GetRawText();
        if(geometry.GetProperty("unsupported").GetArrayLength()!=0)throw new NotSupportedException("Unresolved geometry");
        Marshal.ThrowExceptionForHR(ConnectBeginModel(device));
        var meshes=geometry.GetProperty("meshes").EnumerateArray().ToArray();
        var byId=meshes.ToDictionary(m=>m.GetProperty("partId").GetString()!);
        for(int i=0;i<meshes.Length;)
        {
            var clip=meshes[i].GetProperty("clip");
            if(clip.ValueKind==JsonValueKind.Null){Draw(meshes[i++]);continue;}
            string key=clip.GetRawText();
            Marshal.ThrowExceptionForHR(ConnectBeginClip(device));
            do{Draw(meshes[i++]);}while(i<meshes.Length&&meshes[i].GetProperty("clip").GetRawText()==key);
            Marshal.ThrowExceptionForHR(ConnectClipMask(device));
            bool ignore=clip.GetProperty("maskOpacity").GetString()=="ignore";
            foreach(var id in clip.GetProperty("maskPartIds").EnumerateArray())
            {
                if(!byId.TryGetValue(id.GetString()!,out var mask))throw new InvalidOperationException("Missing mask geometry");
                Draw(mask,ignore); // Public renderer draws mask sources directly, without recursively applying their clip.
            }
            Marshal.ThrowExceptionForHR(ConnectEndClip(device));
        }
        bool sendEnabled=spoutEnabled?.Invoke()==true;
        int sendResult=ConnectSpoutFrame(device,sendEnabled);
        SpoutStatistics.Record(sendEnabled,sendResult);Volatile.Write(ref SpoutResult,sendResult);
        Marshal.ThrowExceptionForHR(ConnectEndModel(device,present()));Interlocked.Increment(ref RenderedFrames);
        if(frames>=10){double total=clock.Elapsed.TotalMilliseconds;measured++;managedBytes+=GC.GetAllocatedBytesForCurrentThread()-allocationStart;evaluationMs+=evaluated;parseMs+=parsed-evaluated;drawMs+=total-parsed;prepareMs+=framePrepareMs;effectMs+=frameEffectMs;if(recentCpu.Count>=512)recentCpu.Dequeue();recentCpu.Enqueue(total);}
        if((++frames==2||latestPose!=null)&&capture!=null)
        {
            var bytes=new byte[view.Width*view.Height*4];Marshal.ThrowExceptionForHR(ConnectReadFrame(device,bytes,(uint)bytes.Length));
            int covered=0;for(int i=3;i<bytes.Length;i+=4)if(bytes[i]>0)covered++;Volatile.Write(ref NonTransparentPixels,covered);
            using var bitmap=new Bitmap(view.Width,view.Height,PixelFormat.Format32bppPArgb);
            var data=bitmap.LockBits(new Rectangle(0,0,view.Width,view.Height),ImageLockMode.WriteOnly,PixelFormat.Format32bppPArgb);
            try{for(int y=0;y<view.Height;y++)Marshal.Copy(bytes,y*view.Width*4,data.Scan0+y*data.Stride,view.Width*4);}finally{bitmap.UnlockBits(data);}
            string destination=latestPose==null?capture:Path.Combine(Path.GetDirectoryName(capture)!,Path.GetFileNameWithoutExtension(capture)+"-pose.png");
            bitmap.Save(destination,ImageFormat.Png);
            if(destination.EndsWith(".reference.png",StringComparison.OrdinalIgnoreCase))File.WriteAllBytes(Path.ChangeExtension(destination,"bgra"),bytes);
        }
    }
    private void Draw(JsonElement mesh,bool ignoreVisualAlpha=false)
    {
        if(!ignoreVisualAlpha&&!mesh.GetProperty("visible").GetBoolean())return;
        float opacity=ignoreVisualAlpha?1:mesh.GetProperty("opacity").GetSingle();if(opacity<=0)return;
        var timer=Stopwatch.StartNew();
        int offset=mesh.GetProperty("vertexOffset").GetInt32(),count=mesh.GetProperty("vertexCount").GetInt32();
        if(drawVertices.Length<count)drawVertices=new Vertex[count];
        var vertices=drawVertices;
        for(int i=0;i<count;i++){int j=offset+i*4;vertices[i]=new Vertex{X=renderVertices[j]/(view.Width/2f)-1,Y=1-renderVertices[j+1]/(view.Height/2f),U=renderVertices[j+2],V=renderVertices[j+3],Opacity=opacity};}
        int indexCount=mesh.GetProperty("indexCount").GetInt32();
        if(drawIndices.Length<indexCount)drawIndices=new uint[indexCount];
        var indices=drawIndices;Array.Copy(renderIndices,mesh.GetProperty("indexOffset").GetInt32(),indices,0,indexCount);
        if(indexCount==0)throw new InvalidOperationException("Empty mesh: "+mesh.GetProperty("partId").GetString());
        framePrepareMs+=timer.Elapsed.TotalMilliseconds;timer.Restart();
        uint texture=textures[mesh.GetProperty("assetId").GetString()!];
        string partId=mesh.GetProperty("partId").GetString()!;
        if(effectTextures.TryGetValue(partId,out var pair)){texture=ignoreVisualAlpha?pair.Mask:pair.Normal;var bytes=evaluator.RenderEffect(partId,effectiveValues,ignoreVisualAlpha);if(bytes!=null)Marshal.ThrowExceptionForHR(ConnectUpdateTexture(device,texture,bytes,(uint)bytes.Length));}
        frameEffectMs+=timer.Elapsed.TotalMilliseconds;
        int blend=ignoreVisualAlpha?0:mesh.GetProperty("blendMode").GetString() switch {"multiply"=>1,"screen"=>2,"additive"=>3,_=>0};
        Marshal.ThrowExceptionForHR(ConnectSetBlendMode(device,blend));
        // Native code copies these arrays synchronously; only the valid prefix is submitted.
        Marshal.ThrowExceptionForHR(ConnectDrawMesh(device,texture,vertices,(uint)count,indices,(uint)indexCount));
        foreach(var path in mesh.GetProperty("paths").EnumerateArray()){
            var color=path.GetProperty("color").EnumerateArray().Select(c=>c.GetSingle()/255).ToArray();if(color[3]<=0)continue;
            float radius=path.GetProperty("radius").GetSingle();
            var stamps=path.GetProperty("centers").EnumerateArray().Select(p=>new PathStamp{X=p.GetProperty("x").GetSingle()/(view.Width/2f)-1,Y=1-p.GetProperty("y").GetSingle()/(view.Height/2f),RadiusX=radius/(view.Width/2f),RadiusY=radius/(view.Height/2f),R=color[0],G=color[1],B=color[2],A=color[3]}).ToArray();
            if(stamps.Length>0)Marshal.ThrowExceptionForHR(ConnectDrawPath(device,stamps,(uint)stamps.Length));
        }
    }
    private static byte[] ReadBitmap(Bitmap bitmap)
    {
        var bytes=new byte[bitmap.Width*bitmap.Height*4];var data=bitmap.LockBits(new Rectangle(0,0,bitmap.Width,bitmap.Height),ImageLockMode.ReadOnly,bitmap.PixelFormat);
        try{for(int y=0;y<bitmap.Height;y++)Marshal.Copy(data.Scan0+y*data.Stride,bytes,y*bitmap.Width*4,bitmap.Width*4);}finally{bitmap.UnlockBits(data);}return bytes;
    }
    public void Dispose(){parameterControl?.Unload(parameterSession);if(measured>0)Timings=new{frames=measured,benchmarkMotion,managedBytesPerFrame=managedBytes/(double)measured,recentP95CpuMs=recentCpu.Order().ElementAt((int)Math.Ceiling(recentCpu.Count*.95)-1),evaluationAndTransferMs=evaluationMs/measured,jsonParseMs=parseMs/measured,drawStageMs=drawMs/measured,vertexPreparationMs=prepareMs/measured,effectAndUploadMs=effectMs/measured,totalCpuMs=(evaluationMs+parseMs+drawMs)/measured,evaluatorProfile=JsonDocument.Parse(evaluator.Profile()).RootElement.Clone(),gpuExecutionMeasured=false};if(device!=0){ConnectDestroy(device);device=0;}evaluator.Dispose();}
    [DllImport("Connect.Graphics",CallingConvention=CallingConvention.Cdecl)] private static extern int ConnectResize(nint device,uint width,uint height);
    [DllImport("Connect.Graphics",CallingConvention=CallingConvention.Cdecl)] private static extern int ConnectCreate(nint hwnd,uint width,uint height,out nint device);
    [DllImport("Connect.Graphics",CallingConvention=CallingConvention.Cdecl)] private static extern int ConnectUploadTexture(nint device,uint width,uint height,byte[] bytes,uint length,out uint texture);
    [DllImport("Connect.Graphics",CallingConvention=CallingConvention.Cdecl)] private static extern int ConnectUpdateTexture(nint device,uint texture,byte[] bytes,uint length);
    [DllImport("Connect.Graphics",CallingConvention=CallingConvention.Cdecl)] private static extern int ConnectSpoutFrame(nint device,bool enabled);
    [DllImport("Connect.Graphics",CallingConvention=CallingConvention.Cdecl)] private static extern int ConnectBeginModel(nint device);
    [DllImport("Connect.Graphics",CallingConvention=CallingConvention.Cdecl)] private static extern int ConnectSetBlendMode(nint device,int mode);
    [DllImport("Connect.Graphics",CallingConvention=CallingConvention.Cdecl)] private static extern int ConnectDrawPath(nint device,PathStamp[] stamps,uint count);
    [DllImport("Connect.Graphics",CallingConvention=CallingConvention.Cdecl)] private static extern int ConnectBeginClip(nint device);
    [DllImport("Connect.Graphics",CallingConvention=CallingConvention.Cdecl)] private static extern int ConnectClipMask(nint device);
    [DllImport("Connect.Graphics",CallingConvention=CallingConvention.Cdecl)] private static extern int ConnectEndClip(nint device);
    [DllImport("Connect.Graphics",CallingConvention=CallingConvention.Cdecl)] private static extern int ConnectDrawMesh(nint device,uint texture,Vertex[] vertices,uint vertexCount,uint[] indices,uint indexCount);
    [DllImport("Connect.Graphics",CallingConvention=CallingConvention.Cdecl)] private static extern int ConnectEndModel(nint device,[MarshalAs(UnmanagedType.Bool)]bool present);
    [DllImport("Connect.Graphics",CallingConvention=CallingConvention.Cdecl)] private static extern int ConnectReadFrame(nint device,byte[] bytes,uint length);
    [DllImport("Connect.Graphics",CallingConvention=CallingConvention.Cdecl)] private static extern void ConnectDestroy(nint device);
}
