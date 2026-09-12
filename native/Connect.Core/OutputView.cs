namespace StandRig.Connect;

public sealed record OutputView(int Width=640,int Height=480,double Zoom=1,double X=0,double Y=0)
{
    public void Validate(){if(Width<256||Height<256||Width>1920||Height>1920||!double.IsFinite(Zoom)||Zoom<.25||Zoom>3||!double.IsFinite(X)||!double.IsFinite(Y))throw new ArgumentException("Invalid output resolution or framing");}
    public OutputView ZoomAt(double multiplier,double u,double v)
    {
        double zoom=Math.Clamp(Zoom*multiplier,.25,3),ratio=zoom/Zoom;
        var next=this with{Zoom=zoom,X=2*(u-.5-(u-.5-X/2)*ratio),Y=2*(v-.5-(v-.5-Y/2)*ratio)};next.Validate();return next;
    }
    public OutputView Pan(double dx,double dy){var next=this with{X=X+2*dx,Y=Y+2*dy};next.Validate();return next;}
    public object Matrix(double stageWidth,double stageHeight)
    {
        Validate();if(!double.IsFinite(stageWidth)||!double.IsFinite(stageHeight)||stageWidth<=0||stageHeight<=0)throw new ArgumentException("Invalid stage size");
        double scale=Math.Min(Width/stageWidth,Height/stageHeight)*Zoom;
        return new{a=scale,b=0,c=0,d=scale,e=(Width-stageWidth*scale)/2+X*Width/2,f=(Height-stageHeight*scale)/2+Y*Height/2};
    }
}
