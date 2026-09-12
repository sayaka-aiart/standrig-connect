namespace StandRig.Connect;

public readonly record struct BodyPoint(double X,double Y,double Z,double Confidence);
public sealed class UpperBodyTracking
{
    private double pitch,lastPitchValid=double.NegativeInfinity;
    public bool PitchVisible {get;private set;}
    private double yaw,roll,lastValid=double.NegativeInfinity,lastTime=double.NaN;
    public bool Visible {get;private set;}
    public IReadOnlyDictionary<string,double> Advance(BodyPoint? left,BodyPoint? right,double seconds,double aspect,BodyPoint? leftHip=null,BodyPoint? rightHip=null)
    {
        if(!double.IsFinite(seconds)||seconds<0||!double.IsFinite(aspect)||aspect<=0||double.IsFinite(lastTime)&&seconds<lastTime)throw new ArgumentException("Invalid body timestamp or aspect");
        double dt=double.IsFinite(lastTime)?Math.Min(seconds-lastTime,.25):.067;lastTime=seconds;
        static bool Valid(BodyPoint p)=>double.IsFinite(p.X)&&double.IsFinite(p.Y)&&double.IsFinite(p.Z)&&double.IsFinite(p.Confidence)&&p.Confidence>=.6&&p.X>=0&&p.X<=1&&p.Y>=0&&p.Y<=1;
        double targetYaw=yaw,targetRoll=roll;
        Visible=left is {} l&&right is {} r&&Valid(l)&&Valid(r)&&Math.Abs(l.X-r.X)*aspect>.05;
        if(Visible){
            var a=left!.Value;var b=right!.Value;
            // Anatomical left appears on the image right in an unmirrored camera.
            double dx=(a.X-b.X)*aspect,dy=a.Y-b.Y,dz=(a.Z-b.Z)*aspect;
            targetYaw=Math.Clamp(Math.Atan2(dz,Math.Abs(dx))/(Math.PI/3),-1,1);
            targetRoll=Math.Clamp(-Math.Atan2(dy,Math.Abs(dx))/(Math.PI/4),-1,1);
            lastValid=seconds;
        }else if(seconds-lastValid>.25){targetYaw=0;targetRoll=0;}
        double targetPitch=pitch;
        PitchVisible=Visible&&leftHip is {} lh&&rightHip is {} rh&&Valid(lh)&&Valid(rh);
        if(PitchVisible){
            var a=left!.Value;var b=right!.Value;var h=leftHip!.Value;var j=rightHip!.Value;
            double vertical=(h.Y+j.Y-a.Y-b.Y)*.5;
            PitchVisible=vertical>.08;
            if(PitchVisible){
                // Normalized depth is measured in image-width units. Forward lean
                // places the shoulders nearer the camera (negative Z) than the hips.
                // Model Body Y uses negative for forward/down, positive for back/up.
                double depth=(h.Z+j.Z-a.Z-b.Z)*.5*aspect;
                targetPitch=Math.Clamp(-Math.Atan2(depth,vertical)/(Math.PI/6),-1,1);
                lastPitchValid=seconds;
            }
        }
        if(!PitchVisible&&seconds-lastPitchValid>.25)targetPitch=0;
        pitch+=(targetPitch-pitch)*(1-Math.Exp(-dt/(PitchVisible?.18:.35)));
        double alpha=1-Math.Exp(-dt/(Visible?.12:.35));
        yaw+=(targetYaw-yaw)*alpha;roll+=(targetRoll-roll)*alpha;
        return new Dictionary<string,double>{{"bodyYaw",yaw},{"bodyRoll",roll},{"bodyPitch",pitch}};
    }
}
