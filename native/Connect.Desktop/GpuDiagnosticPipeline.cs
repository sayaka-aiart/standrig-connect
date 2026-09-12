using System.Runtime.InteropServices;
using StandRig.Connect;
namespace StandRig.Connect.Desktop;

internal sealed class GpuDiagnosticPipeline : IFramePipeline
{
    private nint device;
    private readonly Func<bool> present;
    private readonly bool verifyPixels;
    internal static long Frames;
    internal static uint Pixel;
    internal GpuDiagnosticPipeline(nint window, Func<bool> present, bool verifyPixels)
    {
        this.present=present;this.verifyPixels=verifyPixels;
        Marshal.ThrowExceptionForHR(ConnectCreate(window,640,480,out device));
    }
    public void Step(double elapsedSeconds, PoseFrame? latestPose)
    {
        Marshal.ThrowExceptionForHR(ConnectDrawDiagnostic(device,(float)((Math.Sin(elapsedSeconds)+1)/2),present()));
        Interlocked.Increment(ref Frames);
        if(verifyPixels){Marshal.ThrowExceptionForHR(ConnectReadPixel(device,out var pixel));Volatile.Write(ref Pixel,pixel);}
    }
    public void Dispose(){if(device!=0){ConnectDestroy(device);device=0;}}
    [DllImport("Connect.Graphics",CallingConvention=CallingConvention.Cdecl)] private static extern int ConnectCreate(nint hwnd,uint width,uint height,out nint device);
    [DllImport("Connect.Graphics",CallingConvention=CallingConvention.Cdecl)] private static extern int ConnectDrawDiagnostic(nint device,float phase,[MarshalAs(UnmanagedType.Bool)]bool present);
    [DllImport("Connect.Graphics",CallingConvention=CallingConvention.Cdecl)] private static extern int ConnectReadPixel(nint device,out uint pixel);
    [DllImport("Connect.Graphics",CallingConvention=CallingConvention.Cdecl)] private static extern void ConnectDestroy(nint device);
}
