using System.Runtime.InteropServices;
using StandRig.Connect;
namespace StandRig.Connect.Desktop;

internal sealed class PoseDetector : IDisposable
{
    internal const string ModelHash="59929E1D1EE95287735DDD833B19CF4AC46D29BC7AFDDBBF6753C459690D574A";
    private nint handle;
    private byte[] rgb=Array.Empty<byte>();
    internal PoseDetector(){
        string model=Path.Combine(AppContext.BaseDirectory,"pose_landmarker_lite.task");
        FaceDetector.CheckHash(model,ModelHash);
        FaceDetector.CheckHash(Path.Combine(AppContext.BaseDirectory,"libmediapipe.dll"),"AA8E6C1B618C30CD3A6AD584DEE1B2F2C99C3F3025D683BADA36E1566D9092B7");
        nint path=Marshal.StringToCoTaskMemUTF8(model);
        try{var options=new Options{Base=new FaceDetector.BaseOptions{Path=path},Mode=2,Poses=1,Detection=.5f,Presence=.5f,Tracking=.5f};FaceDetector.Check(MpPoseLandmarkerCreate(ref options,out handle,out var error),error);}finally{Marshal.FreeCoTaskMem(path);}
    }
    internal (BodyPoint? Left,BodyPoint? Right,BodyPoint? LeftHip,BodyPoint? RightHip) Detect(byte[] pixels,int width,int height,long milliseconds){
        int count=checked(width*height);if(rgb.Length!=count*3)rgb=new byte[count*3];
        for(int i=0;i<count;i++){rgb[i*3]=pixels[i*4+2];rgb[i*3+1]=pixels[i*4+1];rgb[i*3+2]=pixels[i*4];}
        nint image=0;Result result=default;bool called=false;
        try{
            FaceDetector.Check(MpImageCreateFromUint8Data(1,width,height,rgb,rgb.Length,out image,out var error),error);
            called=true;FaceDetector.Check(MpPoseLandmarkerDetectForVideo(handle,image,0,milliseconds,ref result,out error),error);
            if(result.Count==0)return(null,null,null,null);
            if(result.Count!=1||result.Landmarks==0)throw new InvalidOperationException("Unexpected pose count");
            var list=Marshal.PtrToStructure<Landmarks>(result.Landmarks);
            if(list.Count!=33||list.Data==0)throw new InvalidOperationException("Invalid pose landmarks");
            BodyPoint Read(int index){var p=Marshal.PtrToStructure<Landmark>(list.Data+index*Marshal.SizeOf<Landmark>());return new(p.X,p.Y,p.Z,p.HasVisibility!=0&&p.HasPresence!=0?Math.Min(p.Visibility,p.Presence):0);}
            return(Read(11),Read(12),Read(23),Read(24));
        }finally{if(called)MpPoseLandmarkerCloseResult(ref result);if(image!=0)MpImageFree(image);}
    }
    public void Dispose(){if(handle==0)return;var old=handle;handle=0;FaceDetector.Check(MpPoseLandmarkerClose(old,out var error),error);}
#pragma warning disable CS0649
    [StructLayout(LayoutKind.Sequential)] private struct Options {public FaceDetector.BaseOptions Base;public int Mode,Poses;public float Detection,Presence,Tracking;public byte Masks;public nint Callback;}
    [StructLayout(LayoutKind.Sequential)] private struct Result {public nint Masks;public uint MaskCount;public nint Landmarks;public uint Count;public nint World;public uint WorldCount;}
    [StructLayout(LayoutKind.Sequential)] private struct Landmarks {public nint Data;public uint Count;}
    [StructLayout(LayoutKind.Sequential)] private struct Landmark {public float X,Y,Z;public byte HasVisibility;public float Visibility;public byte HasPresence;public float Presence;public nint Name;}
#pragma warning restore CS0649
    [DllImport("libmediapipe",CallingConvention=CallingConvention.Cdecl)]private static extern int MpPoseLandmarkerCreate(ref Options options,out nint handle,out nint error);
    [DllImport("libmediapipe",CallingConvention=CallingConvention.Cdecl)]private static extern int MpPoseLandmarkerDetectForVideo(nint handle,nint image,nint options,long time,ref Result result,out nint error);
    [DllImport("libmediapipe",CallingConvention=CallingConvention.Cdecl)]private static extern void MpPoseLandmarkerCloseResult(ref Result result);
    [DllImport("libmediapipe",CallingConvention=CallingConvention.Cdecl)]private static extern int MpPoseLandmarkerClose(nint handle,out nint error);
    [DllImport("libmediapipe",CallingConvention=CallingConvention.Cdecl)]private static extern int MpImageCreateFromUint8Data(int format,int width,int height,byte[] data,int size,out nint image,out nint error);
    [DllImport("libmediapipe",CallingConvention=CallingConvention.Cdecl)]private static extern void MpImageFree(nint image);
}
