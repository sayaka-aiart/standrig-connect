using StandRig.Connect;

static void Check(bool condition, string name) { if (!condition) throw new Exception(name); Console.WriteLine("PASS " + name); }
var sends=new SendStatistics();sends.Record(false,unchecked((int)0x80004005));
Check(sends.Snapshot().Attempts==0,"disabled sends excluded");
sends.Record(true,0);sends.Record(true,unchecked((int)0x80004005));sends.Record(true,0);sends.Record(true,1);
var totals=sends.Snapshot();
Check(totals.Attempts==4&&totals.Succeeded==2&&totals.Failed==1&&totals.Skipped==1&&totals.LastError==unchecked((int)0x80004005),"transient failure survives subsequent success");
Parallel.For(0,1000,_=>sends.Record(true,0));
Check(sends.Snapshot().Attempts==1004&&totals.Attempts==4,"atomic counters and immutable snapshot");
Check(new SendStatistics().Snapshot().Attempts==0,"fresh model statistics");var slot = new LatestPose();
var values = new Dictionary<string,double>{{"ParamAngleX",1}};
slot.Submit(new PoseFrame(1,values));values["ParamAngleX"]=99;
Check(slot.Take()!.Values["ParamAngleX"]==1,"immutable frame");
Check(!slot.Submit(new PoseFrame(1,values)),"stale sequence rejected");
for(int i=2;i<100;i++)slot.Submit(new PoseFrame(i,values));
Check(slot.Take()!.Sequence==99 && slot.Take()==null,"latest only, bounded backlog");
try { slot.Submit(new PoseFrame(100,new Dictionary<string,double>{{"x",double.NaN}})); throw new Exception("accepted NaN"); } catch(ArgumentException){Console.WriteLine("PASS finite validation");}
using(var host=new EngineHost())
{
    host.Start(()=>new DiagnosticPipeline());Thread.Sleep(150);long before=host.Status.Ticks;
    Thread.Sleep(300);Check(host.Status.Ticks>before+5,"independent worker");
    host.Start(()=>throw new Exception("must not start duplicate"));
    Check(host.Stop(TimeSpan.FromSeconds(2)),"bounded stop");long stopped=host.Status.Ticks;
    var timing=host.Timing!;
    Check(timing.Frames>0&&timing.Waits>0&&timing.Waits<=2*(timing.Frames+10),"frame waits do not busy-poll fractional milliseconds");
    Thread.Sleep(80);Check(host.Status.Ticks==stopped,"no work after stop");
    host.Start(()=>throw new Exception("expected-failure"));Thread.Sleep(100);
    Check(host.Status.Error=="expected-failure" && !host.Status.Running,"worker failure surfaced");
    host.Start(()=>new DiagnosticPipeline());Thread.Sleep(100);Check(host.Status.Running,"restart after failure");
}
Console.WriteLine("All native core checks passed");
var manual=new Dictionary<string,double>{{"ParamAngleX",7},{"Custom",.4}};
var limits=new Dictionary<string,(double Min,double Max)>{{"ParamAngleX",(-30,30)},{"ParamMouthOpen",(0,1)}};
for(int frame=0;frame<1800;frame++){
 var demo=DemoPose.Apply(manual,limits,frame/60d);
 if(demo["ParamAngleX"]< -30||demo["ParamAngleX"]>30||demo["ParamMouthOpen"]<0||demo["ParamMouthOpen"]>1||demo["Custom"]!=.4)throw new Exception("Demo range/custom channel mismatch");
}
Check(manual["ParamAngleX"]==7&&!manual.ContainsKey("ParamMouthOpen"),"demo leaves external input intact for OFF restoration");
manual["ParamAngleX"]=12;
Check(DemoPose.Apply(manual,limits,1)["Custom"]==.4&&manual["ParamAngleX"]==12,"input updates during demo remain available");
var idleInput=new Dictionary<string,double>{{"ParamAngleX",0},{"ParamAngleY",0},{"ParamAngleZ",0},{"ParamBodyAngleX",0},{"ParamBodyAngleY",0},{"ParamBodyAngleZ",0},{"ParamEyeLOpen",.7},{"ParamMouthOpen",.3}};
var idleRanges=idleInput.ToDictionary(p=>p.Key,p=>p.Key.Contains("Open")?(0d,1d):(-30d,30d));
foreach(var preset in new[]{IdlePreset.Breathing,IdlePreset.Sway,IdlePreset.Random}){
    var idle=new IdlePose();Dictionary<string,double>? last=null;double extent=0;
    for(int i=0;i<60*60;i++){
        var pose=idle.Apply(idleInput,idleRanges,i/60d,preset);
        if(pose["ParamEyeLOpen"]!=.7||pose["ParamMouthOpen"]!=.3)throw new Exception("idle touched expression");
        foreach(var id in idleInput.Keys.Where(id=>!id.Contains("Open"))){
            if(Math.Abs(pose[id])>2.101)throw new Exception("idle too wide");
            if(last!=null&&Math.Abs(pose[id]-last[id])>.08)throw new Exception("idle discontinuity");
            extent=Math.Max(extent,Math.Abs(pose[id]));
        }
        last=pose;
    }
    Check(extent>.1,"idle moves gently "+preset);
    Dictionary<string,double>? off=null;
    for(int i=3600;i<4200;i++)off=idle.Apply(idleInput,idleRanges,i/60d,IdlePreset.Off);
    Check(off!.All(p=>Math.Abs(p.Value-idleInput[p.Key])<1e-6),"idle fades to base "+preset);
}
Check(idleInput["ParamAngleX"]==0,"idle preserves source");
var breathOnly=new IdlePose();
var breathRanges=new Dictionary<string,(double Min,double Max)>{{"ParamBreath",(0,1)}};
var breathInput=new Dictionary<string,double>{{"ParamBreath",0}};
for(int i=0;i<600;i++){
    var pose=breathOnly.Apply(breathInput,breathRanges,i/60d,IdlePreset.Random);
    if(pose.Count!=1||pose["ParamBreath"]<0||pose["ParamBreath"]>.35)throw new Exception("breath range or missing channel");
}
Check(true,"idle supported channels only and breath range");
await ParameterApiChecks.Run();
var framing=new OutputView(1080,1920);
var zoomed=framing.ZoomAt(1.5,.7,.3);
Check(Math.Abs(zoomed.X+.2)<1e-9&&Math.Abs(zoomed.Y-.2)<1e-9,"cursor anchored zoom");
Check(framing.Pan(.1,-.1).X==.2&&framing.Pan(.1,-.1).Y==-.2,"drag uses preview normalized coordinates");
Check(framing.ZoomAt(100,.5,.5).Zoom==3&&framing.ZoomAt(.001,.5,.5).Zoom==.25,"zoom bounds");
using(var matrix=System.Text.Json.JsonDocument.Parse(System.Text.Json.JsonSerializer.Serialize(framing.Matrix(100,200)))){
 Check(matrix.RootElement.GetProperty("a").GetDouble()==9.6&&matrix.RootElement.GetProperty("e").GetDouble()==60,"portrait fit preserves aspect ratio");
}
try{new OutputView(9999,1080).Validate();throw new Exception("Oversize output accepted");}catch(ArgumentException){}

var movedBeyondCanvas=new OutputView(1080,1920,3).Pan(0,.8).Pan(0,.8);
Check(Math.Abs(movedBeyondCanvas.Y-3.2)<1e-9,"zoomed drag continues beyond former half-canvas limit");
var zoomAfterPan=movedBeyondCanvas.ZoomAt(.5,.5,.5);
Check(Math.Abs(zoomAfterPan.Y-1.6)<1e-9,"zoom preserves framing beyond old pan boundary");
Check(Math.Abs(movedBeyondCanvas.Pan(0,-1.6).Y)<1e-9,"unrestricted drag is reversible");
try{new OutputView(X:double.PositiveInfinity).Validate();throw new Exception("Infinite pan accepted");}catch(ArgumentException){}
