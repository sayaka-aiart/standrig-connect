using System.Runtime.InteropServices;
using System.Security.Cryptography;
namespace StandRig.Connect.Desktop;

internal sealed record FaceObservation(int Count,Dictionary<string,float> Blendshapes,float[] MatrixRowMajor);
internal sealed class FaceDetector : IDisposable
{
    private nint handle;
    private byte[] rgb=Array.Empty<byte>();
    internal FaceDetector()
    {
        string model=Path.Combine(AppContext.BaseDirectory,"face_landmarker.task");
        CheckHash(model,"64184E229B263107BC2B804C6625DB1341FF2BB731874B0BCC2FE6544E0BC9FF");
        CheckHash(Path.Combine(AppContext.BaseDirectory,"libmediapipe.dll"),"AA8E6C1B618C30CD3A6AD584DEE1B2F2C99C3F3025D683BADA36E1566D9092B7");
        nint path=Marshal.StringToCoTaskMemUTF8(model);
        try{var options=new Options {Base=new BaseOptions{Path=path},Mode=2,Faces=1,Detection=.5f,Presence=.5f,Tracking=.5f,Blendshapes=1,Matrices=1};Check(MpFaceLandmarkerCreate(ref options,out handle,out var error),error);}
        finally{Marshal.FreeCoTaskMem(path);}
    }
    internal static void CheckHash(string path,string expected){using var stream=File.OpenRead(path);if(Convert.ToHexString(SHA256.HashData(stream))!=expected)throw new InvalidOperationException("Inference asset hash mismatch");}
    internal FaceObservation Detect(byte[] bgrx,int width,int height,long milliseconds)
    {
        int count=checked(width*height);if(rgb.Length!=count*3)rgb=new byte[count*3];
        for(int i=0;i<count;i++){rgb[i*3]=bgrx[i*4+2];rgb[i*3+1]=bgrx[i*4+1];rgb[i*3+2]=bgrx[i*4];}
        nint image=0;Result result=default;bool called=false;
        try{
            Check(MpImageCreateFromUint8Data(1,width,height,rgb,rgb.Length,out image,out var error),error);
            called=true;Check(MpFaceLandmarkerDetectForVideo(handle,image,0,milliseconds,ref result,out error),error);
            if(result.FaceCount>1||result.BlendCount>1||result.MatrixCount>1)throw new InvalidOperationException("Unexpected face count");
            var scores=new Dictionary<string,float>();var matrix=Array.Empty<float>();
            if(result.FaceCount>0&&result.BlendCount>0){
                var categories=Marshal.PtrToStructure<Categories>(result.Blends);if(categories.Count>256)throw new InvalidOperationException("Invalid blendshape count");
                for(int i=0;i<categories.Count;i++){var category=Marshal.PtrToStructure<Category>(categories.Data+i*Marshal.SizeOf<Category>());if(!float.IsFinite(category.Score))throw new InvalidOperationException("Non-finite face score");scores[Marshal.PtrToStringUTF8(category.Name)!]=category.Score;}
            }
            if(result.FaceCount>0&&result.MatrixCount>0){var m=Marshal.PtrToStructure<Matrix>(result.Matrices);if(m.Rows!=4||m.Columns!=4)throw new InvalidOperationException("Invalid face matrix");var column=new float[16];Marshal.Copy(m.Data,column,0,16);matrix=new float[16];for(int r=0;r<4;r++)for(int c=0;c<4;c++){float v=column[c*4+r];if(!float.IsFinite(v))throw new InvalidOperationException("Non-finite face matrix");matrix[r*4+c]=v;}}
            return new((int)result.FaceCount,scores,matrix);
        }finally{if(called)MpFaceLandmarkerCloseResult(ref result);if(image!=0)MpImageFree(image);}
    }
    internal static void Check(int status,nint error){try{if(status!=0)throw new InvalidOperationException(Marshal.PtrToStringUTF8(error)??("MediaPipe error "+status));}finally{if(error!=0)MpErrorFree(error);}}
    public void Dispose(){if(handle==0)return;var value=handle;handle=0;Check(MpFaceLandmarkerClose(value,out var error),error);}
    // ABI from official 0.10.35 wheel ctypes definitions, not mutable master headers.
#pragma warning disable CS0649
    [StructLayout(LayoutKind.Sequential)] internal struct BaseOptions {public nint Buffer;public uint Size;public nint Path;public int Delegate,Environment,System;public nint Version,Certificates;}
    [StructLayout(LayoutKind.Sequential)] private struct Options {public BaseOptions Base;public int Mode,Faces;public float Detection,Presence,Tracking;public byte Blendshapes,Matrices;public nint Callback;}
    [StructLayout(LayoutKind.Sequential)] private struct Result {public nint Faces;public uint FaceCount;public nint Blends;public uint BlendCount;public nint Matrices;public uint MatrixCount;}
    [StructLayout(LayoutKind.Sequential)] private struct Categories {public nint Data;public uint Count;}
    [StructLayout(LayoutKind.Sequential)] private struct Category {public int Index;public float Score;public nint Name,DisplayName;}
    [StructLayout(LayoutKind.Sequential)] private struct Matrix {public uint Rows,Columns;public nint Data;}
#pragma warning restore CS0649
    [DllImport("libmediapipe",CallingConvention=CallingConvention.Cdecl)]private static extern int MpFaceLandmarkerCreate(ref Options options,out nint handle,out nint error);
    [DllImport("libmediapipe",CallingConvention=CallingConvention.Cdecl)]private static extern int MpFaceLandmarkerDetectForVideo(nint handle,nint image,nint options,long time,ref Result result,out nint error);
    [DllImport("libmediapipe",CallingConvention=CallingConvention.Cdecl)]private static extern void MpFaceLandmarkerCloseResult(ref Result result);
    [DllImport("libmediapipe",CallingConvention=CallingConvention.Cdecl)]private static extern int MpFaceLandmarkerClose(nint handle,out nint error);
    [DllImport("libmediapipe",CallingConvention=CallingConvention.Cdecl)]private static extern int MpImageCreateFromUint8Data(int format,int width,int height,byte[] data,int size,out nint image,out nint error);
    [DllImport("libmediapipe",CallingConvention=CallingConvention.Cdecl)]private static extern void MpImageFree(nint image);
    [DllImport("libmediapipe",CallingConvention=CallingConvention.Cdecl)]private static extern void MpErrorFree(nint error);
}
