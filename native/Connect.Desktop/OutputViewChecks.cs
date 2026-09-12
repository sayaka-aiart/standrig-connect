using System.Text.Json;
using StandRig.Connect;
namespace StandRig.Connect.Desktop;

internal static class OutputViewChecks
{
    internal static void Run(string model,string directory)
    {
        Directory.CreateDirectory(directory);directory=Path.GetFullPath(directory);
        string capture=Path.Combine(directory,"frame.png"),pose=Path.Combine(directory,"frame-pose.png");
        using var surface=new Form{ClientSize=new Size(400,400)};OutputView view=new();
        using var pipeline=new ModelRenderPipeline(model,surface.Handle,()=>false,_=>{},capture,physicsEnabled:false,outputView:()=>view);
        var results=new List<object>();byte[]? baseline=null;long sequence=0;
        foreach(var entry in new[]{("baseline",new OutputView()),("landscape",new OutputView(1920,1080)),("portrait",new OutputView(1080,1920)),("zoom",new OutputView(1080,1920,1.8,.15,.1)),("restore",new OutputView())}){
            view=entry.Item2;for(int i=0;i<3;i++)pipeline.Step(sequence/60d,null);
            pipeline.Step(++sequence/60d,new PoseFrame(sequence,new Dictionary<string,double>()));
            byte[] bytes=File.ReadAllBytes(pose);File.Copy(pose,Path.Combine(directory,entry.Item1+".png"),true);
            using var image=Image.FromFile(pose);if(image.Width!=view.Width||image.Height!=view.Height||ModelRenderPipeline.NonTransparentPixels==0)throw new Exception("Output dimensions/coverage failed");
            if(entry.Item1=="baseline")baseline=bytes;if(entry.Item1=="restore"&&!baseline!.SequenceEqual(bytes))throw new Exception("Resolution restore changed static pixels");
            results.Add(new{scenario=entry.Item1,width=image.Width,height=image.Height,covered=ModelRenderPipeline.NonTransparentPixels});
        }
        if(File.ReadAllBytes(Path.Combine(directory,"portrait.png")).SequenceEqual(File.ReadAllBytes(Path.Combine(directory,"zoom.png"))))throw new Exception("Framing had no effect");
        File.WriteAllText(Path.Combine(directory,"result.json"),JsonSerializer.Serialize(new{passed=true,samePipelineResize=true,restoredPixelsEqual=true,cameraOpened=false,spoutReceiverVerified=false,results},new JsonSerializerOptions{WriteIndented=true}));
    }
}
