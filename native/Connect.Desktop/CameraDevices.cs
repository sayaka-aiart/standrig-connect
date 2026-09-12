using System.Runtime.InteropServices;
namespace StandRig.Connect.Desktop;
internal sealed record CameraDevice(string Name,string SymbolicLink)
{
    public override string ToString()=>Name;
}
internal static class CameraDevices
{
    internal static CameraDevice[] Enumerate()
    {
        nint memory=0;
        try{
            Marshal.ThrowExceptionForHR(ConnectListCameras(out memory,out uint length,out uint count));
            if(count==0)return Array.Empty<CameraDevice>();
            if(count>256||length>16_777_216||memory==0)throw new InvalidOperationException("Invalid camera enumeration result");
            string text=Marshal.PtrToStringUni(memory,checked((int)length))!;
            var fields=text.Split('\0');if(fields.Length!=count*2+1)throw new InvalidOperationException("Invalid camera enumeration strings");
            return Enumerable.Range(0,(int)count).Select(i=>new CameraDevice(fields[i*2],fields[i*2+1])).ToArray();
        }finally{Marshal.FreeCoTaskMem(memory);}
    }
    [DllImport("Connect.Camera",CallingConvention=CallingConvention.Cdecl)]
    private static extern int ConnectListCameras(out nint data,out uint length,out uint count);
}
