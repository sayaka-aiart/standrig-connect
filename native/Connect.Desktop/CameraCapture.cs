using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using StandRig.Connect.Evaluation;
namespace StandRig.Connect.Desktop;

internal sealed record CameraCaptureState(long Frames,int Width,int Height,string? Error)
{ public FaceObservation? Face {get;init;} public bool BodyEnabled {get;init;} public bool BodyVisible {get;init;} public bool BodyPitchVisible {get;init;} public double InferenceMs {get;init;} public Dictionary<string,double>? Inputs {get;init;} }
internal sealed class CameraCapture : IDisposable
{
    private Process? child;
    private readonly SemaphoreSlim stopGate=new(1,1);
    private bool disposed;
    private Task? pump;
    private long inputSequence;
    internal long RecognizedFrames=>Interlocked.Read(ref inputSequence);
    internal object? Resources {get{try{var p=child;if(p==null||p.HasExited)return null;p.Refresh();return new{privateBytes=p.PrivateMemorySize64,workingSet=p.WorkingSet64,handles=p.HandleCount};}catch(InvalidOperationException){return null;}}}
    internal event Action<long,IReadOnlyDictionary<string,double>>? InputReceived;
    private CameraCaptureState state=new(0,0,0,null);
    internal CameraCaptureState State=>Volatile.Read(ref state);
    internal bool Running{get{try{return child is {HasExited:false};}catch(InvalidOperationException){return false;}}}
    internal void Start(CameraDevice device,bool inference=false,bool upperBody=false)
    {
        ObjectDisposedException.ThrowIf(disposed,this);
        if(child!=null)throw new InvalidOperationException("先にカメラを停止してください");
        state=new(0,0,0,null);
        var info=new ProcessStartInfo(Environment.ProcessPath!){UseShellExecute=false,CreateNoWindow=true,RedirectStandardInput=true,RedirectStandardOutput=true,RedirectStandardError=true};
        info.ArgumentList.Add(inference?"--face-camera-worker":"--camera-worker");info.ArgumentList.Add(Environment.ProcessId.ToString());
        if(upperBody&&inference)info.Environment["STANDRIG_UPPER_BODY"]="1";else info.Environment.Remove("STANDRIG_UPPER_BODY");
        child=Process.Start(info)??throw new InvalidOperationException("Camera worker failed to start");
        var process=child;
        process.ErrorDataReceived+=(_,_)=>{};process.BeginErrorReadLine();
        try{process.StandardInput.WriteLine(device.SymbolicLink);process.StandardInput.Flush();}
        catch{process.Kill(true);process.Dispose();child=null;throw;}
        pump=Task.Run(async()=>{
            try{
                while(await process.StandardOutput.ReadLineAsync().ConfigureAwait(false) is {} line){
                    if(line.Length>16384)throw new InvalidOperationException("Invalid camera status");
                    var next=JsonSerializer.Deserialize<CameraCaptureState>(line)??throw new InvalidOperationException("Missing camera status");Volatile.Write(ref state,next);
                    if(next.Error==null&&next.Face?.Count==1&&next.Inputs!=null)InputReceived?.Invoke(Interlocked.Increment(ref inputSequence),next.Inputs);
                }
                await process.WaitForExitAsync().ConfigureAwait(false);
                if(process.ExitCode!=0&&State.Error==null)Volatile.Write(ref state,State with{Error="Camera worker exited: "+process.ExitCode});
            }catch(Exception ex){Volatile.Write(ref state,State with{Error=ex.Message});}
        });
    }
    internal async Task<bool> StopAsync()
    {
        await stopGate.WaitAsync().ConfigureAwait(false);
        try{
        var process=child;if(process==null)return true;
        bool graceful=true;
        try{
            try{process.StandardInput.Close();}catch(IOException){}
            var exit=process.WaitForExitAsync();
            if(await Task.WhenAny(exit,Task.Delay(2000)).ConfigureAwait(false)!=exit){graceful=false;process.Kill(true);}
            await process.WaitForExitAsync().ConfigureAwait(false);
            if(pump!=null)await pump.ConfigureAwait(false);
        }finally{process.Dispose();child=null;pump=null;}
        return graceful;
        }finally{stopGate.Release();}
    }
    public void Dispose(){disposed=true;StopAsync().GetAwaiter().GetResult();}

    internal static int RunWorker(int parentId,bool inference=false)
    {
        nint camera=0;int stop=0;
        try{
            var parent=Process.GetProcessById(parentId); // Held by watchdog until process exit.
            _=Task.Run(()=>{try{parent.WaitForExit();Environment.Exit(0);}catch{Environment.Exit(0);}});
            string link=Console.ReadLine()??throw new InvalidOperationException("Missing device");
            if(link.Length>32768)throw new InvalidOperationException("Invalid device");
            _=Task.Run(()=>{Console.ReadLine();Volatile.Write(ref stop,1);});
            using var detector=inference?new FaceDetector():null;
            using var pose=inference&&Environment.GetEnvironmentVariable("STANDRIG_UPPER_BODY")=="1"?new PoseDetector():null;
            var body=new StandRig.Connect.UpperBodyTracking();double nextPose=0;
            (StandRig.Connect.BodyPoint? Left,StandRig.Connect.BodyPoint? Right,StandRig.Connect.BodyPoint? LeftHip,StandRig.Connect.BodyPoint? RightHip) shoulders=(null,null,null,null);
            using var converter=inference?new ModelEvaluator():null;
            Marshal.ThrowExceptionForHR(ConnectOpenCamera(link,out camera));
            var pixels=new byte[1920*1080*4];long frames=0;
            var clock=Stopwatch.StartNew();long previousMs=-1;
            while(Volatile.Read(ref stop)==0){
                int hr=ConnectReadCamera(camera,pixels,(uint)pixels.Length,out uint width,out uint height);Marshal.ThrowExceptionForHR(hr);
                if(hr==1){Thread.Sleep(1);continue;}
                FaceObservation? face=null;double start=clock.Elapsed.TotalMilliseconds;
                if(detector!=null){long time=Math.Max(previousMs+1,(long)start);face=detector.Detect(pixels,(int)width,(int)height,time);previousMs=time;}
                var inputs=face==null?null:JsonSerializer.Deserialize<Dictionary<string,double>>(converter!.ConvertFace(JsonSerializer.Serialize(face)));
                if(pose!=null){
                    if(start>=nextPose){shoulders=pose.Detect(pixels,(int)width,(int)height,previousMs);nextPose=clock.Elapsed.TotalMilliseconds+66.667;}
                    var bodyInputs=body.Advance(shoulders.Left,shoulders.Right,start/1000,(double)width/height,shoulders.LeftHip,shoulders.RightHip);
                    if(inputs!=null)foreach(var pair in bodyInputs)inputs[pair.Key]=pair.Value;
                }
                // Raw BGRX stays in this process; only compact face results cross the pipe.
                Console.WriteLine(JsonSerializer.Serialize(new CameraCaptureState(++frames,(int)width,(int)height,null){Face=face,Inputs=inputs,BodyEnabled=pose!=null,BodyVisible=body.Visible,BodyPitchVisible=body.PitchVisible,InferenceMs=detector==null?0:clock.Elapsed.TotalMilliseconds-start}));
            }
            return 0;
        }catch(Exception ex){Console.WriteLine(JsonSerializer.Serialize(new CameraCaptureState(0,0,0,ex.Message)));return 1;}
        finally{if(camera!=0)ConnectCloseCamera(camera);}
    }
    [DllImport("Connect.Camera",CallingConvention=CallingConvention.Cdecl,CharSet=CharSet.Unicode)]private static extern int ConnectOpenCamera(string link,out nint camera);
    [DllImport("Connect.Camera",CallingConvention=CallingConvention.Cdecl)]private static extern int ConnectReadCamera(nint camera,[Out]byte[] pixels,uint capacity,out uint width,out uint height);
    [DllImport("Connect.Camera",CallingConvention=CallingConvention.Cdecl)]private static extern void ConnectCloseCamera(nint camera);
}
