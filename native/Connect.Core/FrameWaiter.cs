using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
namespace StandRig.Connect;

// Dedicated waitable timer; no process/global timer-resolution change or busy spin.
internal sealed class FrameWaiter : IDisposable
{
    private readonly EventWaitHandle? timer;
    private readonly WaitHandle[]? handles;
    private readonly CancellationToken token;
    internal FrameWaiter(CancellationToken token)
    {
        this.token=token;
        if(!OperatingSystem.IsWindows())return;
        var handle=CreateWaitableTimerExW(0,null,2,0x1F0003);
        if(handle.IsInvalid){handle.Dispose();return;}
        timer=new EventWaitHandle(false,EventResetMode.AutoReset);
        var original=timer.SafeWaitHandle;timer.SafeWaitHandle=handle;original.Dispose();
        handles=new WaitHandle[]{token.WaitHandle,timer};
    }
    internal void Wait(double seconds)
    {
        if(timer!=null){
            long due=-Math.Max(1,(long)Math.Ceiling(seconds*10_000_000));
            if(SetWaitableTimer(timer.SafeWaitHandle,ref due,0,0,0,false)){WaitHandle.WaitAny(handles!);return;}
        }
        token.WaitHandle.WaitOne((int)Math.Ceiling(seconds*1000));
    }
    public void Dispose()=>timer?.Dispose();
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
    private static extern SafeWaitHandle CreateWaitableTimerExW(nint attributes,string? name,uint flags,uint access);
    [DllImport("kernel32.dll",SetLastError=true)]
    [return:MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetWaitableTimer(SafeWaitHandle handle,ref long dueTime,int period,nint callback,nint argument,[MarshalAs(UnmanagedType.Bool)]bool resume);
}
