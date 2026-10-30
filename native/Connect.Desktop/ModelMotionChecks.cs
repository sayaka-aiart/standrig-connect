using System.Diagnostics;
using System.Text.Json;
using StandRig.Connect;
using StandRig.Connect.Evaluation;
namespace StandRig.Connect.Desktop;

internal static class ModelMotionChecks
{
    public static void Run(string model,string motionPath,string directory){
        directory=Path.GetFullPath(directory);Directory.CreateDirectory(directory);
        string capture=Path.Combine(directory,"frame.png"),pose=Path.Combine(directory,"frame-pose.png");
        using var surface=new Form{ClientSize=new Size(640,480),ShowInTaskbar=false};
        var poses=new(string Name,Dictionary<string,double> Values)[]{
            ("neutral",new()),("face-left",new(){{"ParamAngleX",-30}}),("face-right",new(){{"ParamAngleX",30}}),
            ("face-up",new(){{"ParamAngleY",20}}),("face-down",new(){{"ParamAngleY",-20}}),
            ("arms-up",new(){{"ParamArmL",-1},{"ParamArmR",-1}}),("arms-down",new(){{"ParamArmL",1},{"ParamArmR",1}}),
            ("compound-left",new(){{"ParamAngleX",-30},{"ParamAngleY",-20},{"ParamBodyAngleX",-15},{"ParamBodyAngleY",-10},{"ParamBodyAngleZ",-10}}),
            ("compound-right",new(){{"ParamAngleX",30},{"ParamAngleY",20},{"ParamBodyAngleX",15},{"ParamBodyAngleY",10},{"ParamBodyAngleZ",10}})};
        var clock=Stopwatch.StartNew();string json=ModelDocument.Read(model);
        using var document=JsonDocument.Parse(json);
        var defaults=document.RootElement.GetProperty("parameters").EnumerateArray().ToDictionary(p=>p.GetProperty("id").GetString()!,p=>p.GetProperty("default").GetDouble());
        var ranges=document.RootElement.GetProperty("parameters").EnumerateArray().ToDictionary(p=>p.GetProperty("id").GetString()!,p=>(Min:p.GetProperty("min").GetDouble(),Max:p.GetProperty("max").GetDouble()));
        using(var pipeline=new ModelRenderPipeline("",surface.Handle,()=>false,_=>{},capture,physicsEnabled:false,modelJson:json)){
            for(int i=0;i<poses.Length;i++){
                var values=new Dictionary<string,double>(defaults);foreach(var p in poses[i].Values)if(values.ContainsKey(p.Key))values[p.Key]=Math.Clamp(p.Value,ranges[p.Key].Min,ranges[p.Key].Max);
                pipeline.Step(i/60d,new PoseFrame(i,values));File.Copy(pose,Path.Combine(directory,poses[i].Name+".png"),true);
            }
        }
        GC.Collect();GC.WaitForPendingFinalizers();
        string motionJson=File.ReadAllText(motionPath);using var clip=JsonDocument.Parse(motionJson);double duration=clip.RootElement.GetProperty("duration").GetDouble();
        if(!double.IsFinite(duration)||duration<=0||duration>60)throw new ArgumentException("Diagnostic motion duration must be at most 60 seconds");
        int loopFrames=(int)Math.Ceiling(duration*30),totalFrames=loopFrames*2+1;
        var motion=new MotionPlayback();motion.Submit(MotionAction.Load,motionJson);motion.Configure(1,true);motion.Submit(MotionAction.Play);
        int count=0;var snapshots=new List<object>();
        using(var pipeline=new ModelRenderPipeline("",surface.Handle,()=>false,_=>{},capture,physicsEnabled:true,motion:motion,modelJson:json)){
            // One warm-up loop, then record the next. A monotonic fixed clock is independent of diagnostic execution speed.
            for(int frame=0;frame<totalFrames;frame++){
                bool save=frame>=loopFrames&&((frame-loopFrames)%60==0||frame==totalFrames-1);
                pipeline.Step(frame/30d,save?new PoseFrame(frame,new Dictionary<string,double>()):null);
                if(motion.State.Error!=null)throw new Exception(motion.State.Error);
                if(save){string name=$"motion-{frame-loopFrames:0000}.png";File.Copy(pose,Path.Combine(directory,name),true);snapshots.Add(new{name,time=motion.State.Time});count++;}
                if(frame%60==0)File.WriteAllText(Path.Combine(directory,"progress.json"),JsonSerializer.Serialize(new{frame,total=totalFrames,seconds=clock.Elapsed.TotalSeconds}));
            }
        }
        if(count==0||ModelRenderPipeline.NonTransparentPixels<=0||motion.State.Name==null||!motion.State.Loop||!motion.State.Running)throw new Exception("Incomplete model motion playback");
        File.WriteAllText(Path.Combine(directory,"result.json"),JsonSerializer.Serialize(new{passed=true,model=Path.GetFileName(model),motion=motion.State,staticPoses=poses.Select(p=>p.Name),motionFrames=totalFrames,snapshots,physicsEnabled=true,seconds=clock.Elapsed.TotalSeconds,timings=ModelRenderPipeline.Timings,resources=ModelRenderPipeline.Resources,cameraOpened=false,spoutReceiverVerified=false},new JsonSerializerOptions{WriteIndented=true}));
    }
}
