using System.Runtime.InteropServices;
using System.Text.Json;
namespace StandRig.Connect.Desktop;

internal static class CompositeRenderChecks
{
    [StructLayout(LayoutKind.Sequential)] private struct Vertex {public float X,Y,U,V,Opacity;}
    [DllImport("Connect.Graphics",CallingConvention=CallingConvention.Cdecl)] private static extern int ConnectCreate(nint window,uint w,uint h,out nint device);
    [DllImport("Connect.Graphics",CallingConvention=CallingConvention.Cdecl)] private static extern int ConnectBeginModel(nint device);
    [DllImport("Connect.Graphics",CallingConvention=CallingConvention.Cdecl)] private static extern int ConnectUploadTexture(nint device,uint w,uint h,byte[] bytes,uint length,out uint texture);
    [DllImport("Connect.Graphics",CallingConvention=CallingConvention.Cdecl)] private static extern int ConnectSetBlendMode(nint device,int mode);
    [DllImport("Connect.Graphics",CallingConvention=CallingConvention.Cdecl)] private static extern int ConnectDrawMesh(nint device,uint texture,Vertex[] vertices,uint count,uint[] indices,uint indexCount);
    [DllImport("Connect.Graphics",CallingConvention=CallingConvention.Cdecl)] private static extern int ConnectReadFrame(nint device,byte[] bytes,uint length);
    [DllImport("Connect.Graphics",CallingConvention=CallingConvention.Cdecl)] private static extern int ConnectResize(nint device,uint w,uint h);
    [DllImport("Connect.Graphics",CallingConvention=CallingConvention.Cdecl)] private static extern int ConnectBeginClip(nint device);
    [DllImport("Connect.Graphics",CallingConvention=CallingConvention.Cdecl)] private static extern int ConnectClipMask(nint device);
    [DllImport("Connect.Graphics",CallingConvention=CallingConvention.Cdecl)] private static extern int ConnectEndClip(nint device);
    [DllImport("Connect.Graphics",CallingConvention=CallingConvention.Cdecl)] private static extern int ConnectEndClipInverted(nint device);
    [DllImport("Connect.Graphics",CallingConvention=CallingConvention.Cdecl)] private static extern void ConnectDestroy(nint device);
    [DllImport("Connect.Graphics",CallingConvention=CallingConvention.Cdecl)] private static extern int ConnectSetColors(nint device,float[] colors);
    private static void Check(int result)=>Marshal.ThrowExceptionForHR(result);
    public static void Run(string report){
        using var window=new Form{ClientSize=new Size(640,480),ShowInTaskbar=false};nint device=0;
        try{
            Check(ConnectCreate(window.Handle,640,480,out device));
            Check(ConnectUploadTexture(device,1,1,[0,0,255,255],4,out uint red));
            Check(ConnectUploadTexture(device,1,1,[0,255,0,255],4,out uint green));
            uint[] triangles=[0,1,2,0,2,3];uint[] doubled=[0,1,2,0,2,3,0,1,2,0,2,3];
            void Draw(uint texture,float opacity,int mode=3,bool duplicate=false){
                Vertex[] v=[new(){X=-1,Y=-1,Opacity=opacity},new(){X=1,Y=-1,Opacity=opacity},new(){X=1,Y=1,Opacity=opacity},new(){X=-1,Y=1,Opacity=opacity}];
                Check(ConnectSetBlendMode(device,mode));var indices=duplicate?doubled:triangles;Check(ConnectDrawMesh(device,texture,v,4,indices,(uint)indices.Length));
            }
            byte[] Pixel(int w=640,int h=480){var data=new byte[w*h*4];Check(ConnectReadFrame(device,data,(uint)data.Length));int offset=((h/2)*w+w/2)*4;return data[offset..(offset+4)];}
            void Near(byte[] actual,params int[] expected){if(actual.Where((v,i)=>Math.Abs(v-expected[i])>1).Any())throw new Exception("Unexpected BGRA "+string.Join(',',actual)+" expected "+string.Join(',',expected));}
            var samples=new List<object>();
            foreach(float t in new[]{0,.25f,.5f,.75f,1}){Check(ConnectBeginModel(device));Draw(red,1-t);Draw(green,t);var pixel=Pixel();Near(pixel,0,(int)Math.Round(255*t),(int)Math.Round(255*(1-t)),255);samples.Add(new{t,bgra=pixel.Select(b=>(int)b)});}
            Check(ConnectBeginModel(device));Draw(red,.5f,duplicate:true);Near(Pixel(),0,0,128,128);
            Check(ConnectBeginModel(device));Draw(red,.5f,0);Draw(green,.5f,0);Near(Pixel(),0,128,64,192);
            Check(ConnectBeginModel(device));Draw(red,1,0);Draw(green,.5f,1);Near(Pixel(),0,0,127,255);
            Check(ConnectBeginModel(device));Draw(red,1,0);Draw(green,.5f,2);Near(Pixel(),0,127,255,255);
            // Multiply over a half-transparent destination, and over a mesh that overlaps itself: each triangle
            // multiplies what the earlier ones left (one pass would leave the red and blue channels at 64).
            Check(ConnectBeginModel(device));Draw(red,.5f,0);Draw(green,.5f,1);Near(Pixel(),0,64,64,191);
            Check(ConnectUploadTexture(device,1,1,[128,128,128,255],4,out uint gray));
            Check(ConnectBeginModel(device));Draw(gray,1,0);Draw(green,.5f,1,duplicate:true);Near(Pixel(),32,128,32,255);
            Check(ConnectBeginModel(device));Check(ConnectBeginClip(device));Draw(red,.5f);Draw(green,.5f);Check(ConnectClipMask(device));Draw(red,.5f,0);Check(ConnectEndClip(device));Near(Pixel(),0,64,64,127);
            // Opaque green through a quarter-opaque mask: a normal clip keeps a quarter, an inverted one three quarters.
            Check(ConnectBeginModel(device));Check(ConnectBeginClip(device));Draw(green,1);Check(ConnectClipMask(device));Draw(red,.25f,0);Check(ConnectEndClip(device));Near(Pixel(),0,64,0,64);
            Check(ConnectBeginModel(device));Check(ConnectBeginClip(device));Draw(green,1);Check(ConnectClipMask(device));Draw(red,.25f,0);Check(ConnectEndClipInverted(device));Near(Pixel(),0,191,0,191);
            // Multiply/screen colors on straight RGB (200,100,50): multiply (.5,1,.25), screen (0,.5,0).
            Check(ConnectUploadTexture(device,1,1,[50,100,200,255],4,out uint opaque));
            Check(ConnectUploadTexture(device,1,1,[25,50,100,128],4,out uint half));
            Check(ConnectSetColors(device,[.5f,1,.25f,0,.5f,0]));
            Check(ConnectBeginModel(device));Draw(opaque,1,0);Near(Pixel(),12,177,100,255);
            // Premultiplied half alpha: the same straight color at alpha 128.
            Check(ConnectBeginModel(device));Draw(half,1,0);Near(Pixel(),6,89,50,128);
            Check(ConnectSetColors(device,[1,1,1,0,0,0]));
            Check(ConnectBeginModel(device));Draw(opaque,1,0);Near(Pixel(),50,100,200,255);
            Check(ConnectResize(device,1080,1080));Check(ConnectBeginModel(device));Draw(red,.5f);Draw(green,.5f);Near(Pixel(1080,1080),0,128,128,255);
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(report))!);
            File.WriteAllText(report,JsonSerializer.Serialize(new{passed=true,actualD3D11=true,opaqueCrossfade=samples,selfOverlapIsolated=true,normalOverUnchanged=true,multiplyAndScreen=true,clipGroup=true,blendColors=true,resize=true,cameraOpened=false},new JsonSerializerOptions{WriteIndented=true}));
        }finally{if(device!=0)ConnectDestroy(device);}
    }
}
