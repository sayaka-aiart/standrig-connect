using System.Text.Json;
using StandRig.Connect;
using StandRig.Connect.Evaluation;

namespace StandRig.Connect.Desktop;
internal static class Program
{
    [STAThread]
    static void Main(string[] args)
    {
        if(args.Length==3&&args[0]=="--output-view-test"){ApplicationConfiguration.Initialize();OutputViewChecks.Run(args[1],args[2]);return;}
        if(args.Length==2&&(args[0]=="--camera-worker"||args[0]=="--face-camera-worker")){Environment.ExitCode=Task.Run(()=>CameraCapture.RunWorker(int.Parse(args[1]),args[0]=="--face-camera-worker")).GetAwaiter().GetResult();return;}
        if(args.Length==2&&args[0]=="--face-engine-test"){
            try{using var detector=new FaceDetector();var result=detector.Detect(new byte[640*480*4],640,480,0);File.WriteAllText(args[1],JsonSerializer.Serialize(new{passed=result.Count==0,faces=result.Count,cameraOpened=false}));}catch(Exception ex){File.WriteAllText(args[1],JsonSerializer.Serialize(new{passed=false,error=ex.Message}));Environment.ExitCode=1;}return;
        }
        if(args.Length==3&&args[0]=="--face-image-test"){
            try{
                using var source=new Bitmap(args[1]);using var bitmap=new Bitmap(source.Width,source.Height,System.Drawing.Imaging.PixelFormat.Format32bppArgb);
                using(var g=Graphics.FromImage(bitmap))g.DrawImageUnscaled(source,0,0);
                var data=bitmap.LockBits(new Rectangle(0,0,bitmap.Width,bitmap.Height),System.Drawing.Imaging.ImageLockMode.ReadOnly,System.Drawing.Imaging.PixelFormat.Format32bppArgb);
                var pixels=new byte[bitmap.Width*bitmap.Height*4];
                try{for(int y=0;y<bitmap.Height;y++)System.Runtime.InteropServices.Marshal.Copy(data.Scan0+y*data.Stride,pixels,y*bitmap.Width*4,bitmap.Width*4);}finally{bitmap.UnlockBits(data);}
                using var detector=new FaceDetector();var result=detector.Detect(pixels,bitmap.Width,bitmap.Height,0);
                bool passed=result.Count==1&&result.Blendshapes.Count==52&&result.MatrixRowMajor.Length==16;
                using var converter=new ModelEvaluator();var inputs=JsonSerializer.Deserialize<Dictionary<string,double>>(converter.ConvertFace(JsonSerializer.Serialize(result)));passed=passed&&inputs?.Count==15&&inputs.Values.All(double.IsFinite);File.WriteAllText(args[2],JsonSerializer.Serialize(new{passed,faces=result.Count,blendshapes=result.Blendshapes.Count,matrixValues=result.MatrixRowMajor.Length,inputChannels=inputs?.Count,cameraOpened=false}));if(!passed)Environment.ExitCode=1;
            }catch(Exception ex){File.WriteAllText(args[2],JsonSerializer.Serialize(new{passed=false,error=ex.Message}));Environment.ExitCode=1;}return;
        }
        ApplicationConfiguration.Initialize();
        if(args.Length==2&&(args[0]=="--camera-capture-test"||args[0]=="--face-capture-test")){
            try{
                var devices=Task.Run(CameraDevices.Enumerate).GetAwaiter().GetResult();
                var device=devices.Single(d=>d.Name=="UGREEN camera 2K");
                using var capture=new CameraCapture();var runs=new List<object>();
                for(int run=0;run<2;run++){
                    capture.Start(device,args[0]=="--face-capture-test");
                    for(int i=0;i<100&&capture.State.Frames<30&&capture.State.Error==null;i++)Thread.Sleep(100);
                    var state=capture.State;bool graceful=capture.StopAsync().GetAwaiter().GetResult();
                    if(state.Frames<30||state.Error!=null)throw new Exception("Camera frames unavailable: "+state.Error);
                    runs.Add(new{state,graceful,stopped=!capture.Running});
                }
                File.WriteAllText(Path.GetFullPath(args[1]),JsonSerializer.Serialize(new{passed=true,runs,imagesSaved=false}));
            }catch(Exception ex){File.WriteAllText(Path.GetFullPath(args[1]),JsonSerializer.Serialize(new{passed=false,error=ex.Message}));Environment.ExitCode=1;}return;
        }
        if(args.Length==2&&args[0]=="--camera-list-test"){
            try{
                var devices=Task.Run(CameraDevices.Enumerate).GetAwaiter().GetResult();
                File.WriteAllText(Path.GetFullPath(args[1]),JsonSerializer.Serialize(new{passed=true,count=devices.Length,names=devices.Select(d=>d.Name),cameraOpened=false}));
            }catch(Exception ex){File.WriteAllText(Path.GetFullPath(args[1]),JsonSerializer.Serialize(new{passed=false,error=ex.Message,cameraOpened=false}));Environment.ExitCode=1;}
            return;
        }
        bool staticRender=args.Length==3&&args[0]=="--render-static-test";
        bool motionTest=args.Length==3&&args[0]=="--motion-render-test";
        bool trackingTest=args.Length==3&&args[0]=="--tracking-render-test";
        bool soak=args.Length==3&&args[0]=="--render-soak";
        bool benchmark=args.Length==3&&(args[0]=="--render-benchmark"||soak);
        bool renderTest=args.Length==3&&(args[0]=="--render-self-test"||staticRender||benchmark||motionTest||trackingTest);
        string? evaluationModel = args.Length == 3 && (args[0] == "--evaluation-self-test"||renderTest) ? args[1] : null;
        string reportPath = evaluationModel == null ? (args.Length > 1 ? args[1] : "") : args[2];
        if(((args.Length==3||args.Length==4)&&args[0]=="--spout-soak-test")||(args.Length==6&&args[0]=="--camera-spout-soak-test")){
            bool withCamera=args[0]=="--camera-spout-soak-test";
            int duration=120;if(args.Length>=4&&(!int.TryParse(args[3],out duration)||duration<10||duration>3600||duration%10!=0)){Console.Error.WriteLine("Duration must be 10–3600 seconds in multiples of 10");Environment.ExitCode=2;return;}
            using var preview=new MainWindow(true);
            preview.Shown+=async(_,_)=>{
                var samples=new List<object>();
                try{
                    preview.StartModelRender(args[1]);if(withCamera)await preview.StartTestCamera(args[4],args[5]);else preview.EnableDemo();preview.SetSpoutEnabled(true);preview.WindowState=FormWindowState.Minimized;
                    await Task.Delay(5000);
                    using var process=System.Diagnostics.Process.GetCurrentProcess();
                    long previousCameraFrames=0;
                    var clock=System.Diagnostics.Stopwatch.StartNew();long ticks=preview.Engine.Status.Ticks;double previous=0;
                    for(int i=0;i<duration/10;i++){
                        await Task.Delay(10000);process.Refresh();double elapsed=clock.Elapsed.TotalSeconds;long current=preview.Engine.Status.Ticks;
                        if(current<=ticks||preview.Engine.Status.Error!=null||Volatile.Read(ref ModelRenderPipeline.SpoutResult)!=0)throw new Exception("Spout/render interrupted");
                        var camera=preview.CameraState;
                        if(withCamera&&(camera.Error!=null||camera.Frames<=previousCameraFrames))throw new Exception("Camera stalled: "+camera.Error);
                        previousCameraFrames=camera.Frames;
                        samples.Add(new{camera=withCamera?new{camera.Frames,faces=camera.Face?.Count,recognizedFrames=preview.RecognizedFrames,camera.InferenceMs,trackingActive=preview.Tracking?.State.Active,trackingSequence=preview.Tracking?.State.Sequence,trackingError=preview.Tracking?.State.Error,resources=preview.CameraResources}:null,seconds=elapsed,fps=(current-ticks)/(elapsed-previous),privateBytes=process.PrivateMemorySize64,workingSet=process.WorkingSet64,handles=process.HandleCount,managedBytes=GC.GetTotalMemory(false),spout=Volatile.Read(ref ModelRenderPipeline.SpoutStatistics).Snapshot()});
                        File.WriteAllText(args[2]+".progress.json",JsonSerializer.Serialize(new{requestedSeconds=duration,samples}));
                        ticks=current;previous=elapsed;
                    }
                    bool cameraStopped=!withCamera||await preview.StopTestCamera();
                    if(!cameraStopped)throw new Exception("Camera required forced termination");
                    bool liveTrackingVerified=withCamera&&preview.RecognizedFrames>0&&preview.Tracking?.State.Sequence>=0;
                    if(!preview.Engine.Stop(TimeSpan.FromSeconds(2)))throw new Exception("Worker stop failed");
                    var sending=Volatile.Read(ref ModelRenderPipeline.SpoutStatistics).Snapshot();
                    if(sending.Attempts==0||sending.Failed!=0||sending.Skipped!=0)Environment.ExitCode=1;
                    File.WriteAllText(args[2],JsonSerializer.Serialize(new{passed=sending.Attempts>0&&sending.Failed==0&&sending.Skipped==0,samples,spout=sending,cameraOpened=withCamera,cameraStopped,liveTrackingVerified,outputVisible=false}));
                }catch(Exception ex){File.WriteAllText(args[2],JsonSerializer.Serialize(new{passed=false,samples,error=ex.Message}));Environment.ExitCode=1;}
                finally{preview.AllowExit=true;preview.Close();}
            };
            Application.Run(preview);return;
        }        if(args.Length==3&&args[0]=="--spout-toggle-test"){
            using var preview=new MainWindow(true);
            preview.Shown+=async(_,_)=>{
                var steps=new List<object>();
                try{
                    preview.StartModelRender(args[1]);preview.EnableDemo();preview.WindowState=FormWindowState.Minimized;
                    for(int cycle=0;cycle<3;cycle++)foreach(bool enabled in new[]{true,false}){
                        preview.SetSpoutEnabled(enabled);long before=preview.Engine.Status.Ticks;
                        for(int attempt=0;attempt<200;attempt++){
                            if(preview.Engine.Status.Error!=null)throw new Exception(preview.Engine.Status.Error);
                            if(preview.Engine.Status.Ticks>before+2&&Volatile.Read(ref ModelRenderPipeline.SpoutResult)==(enabled?0:1))break;
                            if(attempt==199)throw new Exception("Spout transition timeout");
                            await Task.Delay(25);
                        }
                        File.WriteAllText(args[2]+".phase.json",JsonSerializer.Serialize(new{cycle,enabled}));
                        await Task.Delay(enabled?5000:2500);
                        long frames=preview.Engine.Status.Ticks-before;
                        if(frames<20||preview.Engine.Status.Error!=null)throw new Exception("Rendering stopped during toggle");
                        steps.Add(new{cycle,enabled,frames,result=Volatile.Read(ref ModelRenderPipeline.SpoutResult),spout=Volatile.Read(ref ModelRenderPipeline.SpoutStatistics).Snapshot()});
                    }
                    if(!preview.Engine.Stop(TimeSpan.FromSeconds(2)))throw new Exception("Worker failed to stop");
                    var totals=Volatile.Read(ref ModelRenderPipeline.SpoutStatistics).Snapshot();
                    if(totals.Attempts==0||totals.Failed!=0||totals.Skipped!=0)throw new Exception("Spout send failures recorded");
                    File.WriteAllText(args[2],JsonSerializer.Serialize(new{passed=true,steps,cameraOpened=false,outputVisible=false}));
                }catch(Exception ex){File.WriteAllText(args[2],JsonSerializer.Serialize(new{passed=false,steps,error=ex.Message}));Environment.ExitCode=1;}
                finally{preview.AllowExit=true;preview.Close();}
            };
            Application.Run(preview);return;
        }        if((args.Length==2||args.Length==3&&args[0]=="--spout-compare-preview")&&(args[0]=="--obs-preview"||args[0]=="--obs-demo-preview"||args[0]=="--spout-demo-preview"||args[0]=="--spout-compare-preview")){
            using var preview=new MainWindow(false);
            preview.Shown+=(_,_)=>{preview.StartModelRender(args[1],capture:args.Length==3?Path.GetFullPath(args[2]):null,physics:args[0]!="--spout-compare-preview");if(args[0]=="--obs-demo-preview"||args[0]=="--spout-demo-preview")preview.EnableDemo();if(args[0]=="--spout-demo-preview")preview.EnableSpout();if(args[0]=="--spout-compare-preview")preview.EnableSpout(false);preview.WindowState=FormWindowState.Minimized;};
            Application.Run(preview);return;
        }        if(args.Length==3&&args[0]=="--slot-roundtrip-test"){
            using var test=new MainWindow(true);
            test.Shown+=async(_,_)=>{
                try{
                    var source=File.ReadAllText(args[1]);string profile;
                    using(var evaluator=new ModelEvaluator()){
                        using var metadata=JsonDocument.Parse(evaluator.Load(source));
                        profile=DefaultTracking.Create(metadata.RootElement.GetProperty("parameters"));
                        evaluator.LoadTrackingProfile(profile);evaluator.CalibrateTracking("{\"facePitch\":0.2}");profile=evaluator.ExportTrackingProfile();
                    }
                    var controls=new TrackingControlsSnapshot(DefaultTracking.Mappings.ToDictionary(m=>m.Source,m=>new TrackingGain(m.Source=="facePitch"?1.5:1,false)),.3,.5,true);
                    profile=DefaultTracking.Adjust(profile,controls.Gains.ToDictionary(p=>p.Key,p=>(p.Value.Gain,p.Value.Invert)),controls.Smoothing,controls.EyeClosed);
                    var store=new ModelSlotStore(Path.Combine(Path.GetDirectoryName(Path.GetFullPath(args[2]))!,"native-slot-"+Guid.NewGuid().ToString("N")));
                    var slot=store.Save(null,"Native slot QA",new(1,source,profile,controls));var saved=store.Load(slot.Id);
                    test.StartModelRender("",capture:Path.ChangeExtension(Path.GetFullPath(args[2]),".png"),modelJson:saved.ModelJson,initialTrackingProfile:saved.ProfileJson,controls:saved.Controls);
                    for(int i=0;i<100&&test.Engine.Status.Error==null&&(!test.Tracking!.State.Loaded||test.Engine.Status.Ticks<3);i++)await Task.Delay(100);
                    if(test.Engine.Status.Error!=null||!test.Tracking!.State.Loaded||test.Engine.Status.Ticks<3)throw new Exception(test.Engine.Status.Error??"Slot render did not start");
                    test.VerifySlotControls(controls);
                    using var actual=JsonDocument.Parse(await test.Tracking.CaptureProfileAsync().WaitAsync(TimeSpan.FromSeconds(3)));
                    if(actual.RootElement.GetProperty("tracking").GetProperty("calibration").GetProperty("facePitch").GetDouble()!=.2)throw new Exception("Saved calibration missing");
                    if(!test.Engine.Stop(TimeSpan.FromSeconds(2)))throw new Exception("Worker did not stop");
                    File.WriteAllText(args[2],JsonSerializer.Serialize(new{passed=true,slotRendered=true,slidersRestored=true,calibrationRestored=true,cameraOpened=false}));
                }catch(Exception ex){File.WriteAllText(args[2],JsonSerializer.Serialize(new{passed=false,error=ex.ToString()}));Environment.ExitCode=1;}
                finally{test.AllowExit=true;test.Close();}
            };
            Application.Run(test);return;
        }
        if ((args.Length == 2 && args[0] == "--self-test") || evaluationModel != null)
        {
            using var test = new MainWindow(true);
            test.Shown += async (_, _) =>
            {
                try
                {
                    if(renderTest)test.StartModelRender(evaluationModel!,Path.ChangeExtension(Path.GetFullPath(reportPath),".png"),!staticRender,benchmark);
                    else if(evaluationModel == null) test.StartDiagnostic(); else test.StartModelEvaluation(evaluationModel);
                    for(int attempt=0;attempt<100&&test.Engine.Status.Ticks<3&&test.Engine.Status.Error==null;attempt++)await Task.Delay(100);
                    // Test fixtures expose this parameter; exercise the same input boundary as future tracking.
                    if(renderTest&&test.Engine.Status.Error==null){test.Engine.Submit(new PoseFrame(1,new Dictionary<string,double>{{"ParamAngleZ",25},{"ParamMouthOpen",1}}));for(int attempt=0;attempt<50&&test.Engine.Status.AppliedSequence!=1&&test.Engine.Status.Error==null;attempt++)await Task.Delay(20);}
                    test.WindowState = FormWindowState.Minimized;
                    if(trackingTest){
                        test.Tracking!.LoadProfile(JsonSerializer.Serialize(new{format="standrig-tracking-profile",version=1,name="test",tracking=new{enabled=true,provider="manual",inputSmoothing=0,mappings=new[]{new{id="face",enabled=true,source="facePitch",parameter="ParamAngleY",scale=10,offset=0,smoothing=0,filter="ema"}}}}));
                        test.Tracking.SetEnabled(true);test.Tracking.Submit(1,new Dictionary<string,double>{{"facePitch",.5}});
                        for(int attempt=0;attempt<50&&!test.Tracking.State.Active;attempt++)await Task.Delay(10);
                        if(!test.Tracking.State.Active)throw new Exception("Tracking input did not activate");
                    }
                    if(motionTest){
                        test.SendMotion(MotionAction.Load,JsonSerializer.Serialize(new{format="standrig-motion",version=1,name="native-motion-test",duration=10,tracks=new[]{new{parameter="ParamAngleZ",keys=new[]{new{time=0,value=-20},new{time=10,value=20}}}}}));
                        test.SendMotion(MotionAction.Play);
                        test.Motion!.Configure(2,true);test.Motion.Seek(9.5);
                    }
                    if(benchmark)await Task.Delay(2000);
                    long before = test.Engine.Status.Ticks;
                    // Block the UI deliberately: worker must continue independently.
                    int blockedMs=soak?30000:benchmark?5000:1200;
                    var intervals=new List<object>();
                    var elapsed=System.Diagnostics.Stopwatch.StartNew();long intervalStart=before;double previousMs=0;
                    for(int i=0;i<(soak?6:1);i++){
                        Thread.Sleep(soak?5000:blockedMs);
                        double ms=elapsed.Elapsed.TotalMilliseconds;long tick=test.Engine.Status.Ticks;
                        intervals.Add(new{durationMs=ms-previousMs,frames=tick-intervalStart,fps=(tick-intervalStart)*1000d/(ms-previousMs)});
                        previousMs=ms;intervalStart=tick;
                    }
                    long after = test.Engine.Status.Ticks;
                    if(trackingTest&&(test.Tracking!.State.Active||test.Tracking.State.Sequence!=1||test.Tracking.State.Error!=null))throw new Exception("Tracking timeout did not remove overlay");
                    if(motionTest&&(test.Motion?.State.Name!="native-motion-test"||test.Motion.State.Time>=9.5||!test.Motion.State.Loop||test.Motion.State.Speed!=2||!test.Motion.State.Running||test.Motion.State.Error!=null))throw new Exception("Motion did not loop during blocked UI");
                    bool minimized = test.WindowState == FormWindowState.Minimized;
                    bool stopped = test.Engine.Stop(TimeSpan.FromSeconds(2));
                    bool renderPassed=!renderTest||(ModelRenderPipeline.RenderedFrames>=20&&ModelRenderPipeline.NonTransparentPixels>0&&test.Engine.Status.AppliedSequence==1);
                    var report = new { passed = renderPassed && minimized && after - before >= 20 && stopped && test.Engine.Status.Error == null && (evaluationModel != null || (GpuDiagnosticPipeline.Frames >= 20 && (GpuDiagnosticPipeline.Pixel >> 24) == 255)), minimized, blockedMs, actualDurationMs=previousMs,intervals, observedFps=(after-before)*1000d/previousMs, ticksWhileUiBlocked = after - before, stopped, cameraOpened = false, modelEvaluated = evaluationModel != null && after > before, error = test.Engine.Status.Error, modelRendered = renderTest&&ModelRenderPipeline.RenderedFrames>0, motionState=test.Motion?.State,timings=ModelRenderPipeline.Timings,engineTiming=test.Engine.Timing,modelFrames=ModelRenderPipeline.RenderedFrames,nonTransparentPixels=ModelRenderPipeline.NonTransparentPixels, spoutSent = false, gpuDiagnosticFrames = Interlocked.Read(ref GpuDiagnosticPipeline.Frames), gpuPixel = Volatile.Read(ref GpuDiagnosticPipeline.Pixel) };
                    File.WriteAllText(Path.GetFullPath(reportPath), JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true }));
                    Environment.ExitCode = report.passed ? 0 : 1;
                }
                catch (Exception ex) { File.WriteAllText(Path.GetFullPath(reportPath), ex.ToString()); Environment.ExitCode = 1; }
                finally { test.AllowExit = true; test.Close(); }
            };
            Application.Run(test); return;
        }
        Application.Run(new MainWindow(false));
    }
}

internal sealed partial class MainWindow : Form
{
    internal EngineHost Engine { get; } = new();
    internal bool AllowExit;
    private readonly bool testing;
    private Form? output;
    private Form? trackingSettings;
    private int presentationEnabled;
    private int demoEnabled;
    private int idlePreset;
    private readonly ParameterControl parameterControl=new();
    private ParameterHttpServer? parameterServer;
    private int spoutEnabled;
    internal MotionPlayback? Motion;
    internal TrackingPlayback? Tracking;
    private readonly CameraCapture cameraCapture=new();
    private readonly CheckBox trackingOn=new() {Text="トラッキング入力を有効化",AutoSize=true};
    private Action? resetTrackingSliders;
    private string mode = "待機中";
    private readonly Label state = new() { AutoSize = true, MaximumSize = new Size(520, 0) };
    private readonly System.Windows.Forms.Timer refresh = new() { Interval = 250 };
    private readonly NotifyIcon tray;
    internal MainWindow(bool testing)
    {
        this.testing = testing;
        cameraCapture.InputReceived+=(sequence,inputs)=>Volatile.Read(ref Tracking)?.Submit(sequence,inputs);
        Text = "StandRig Connect — Native Preview"; ClientSize = new Size(600, 430); MinimumSize=new Size(600,400);
        ShowInTaskbar = !testing;
        var panel = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, WrapContents = false, AutoScroll=true, Padding = new Padding(20) };
        panel.Controls.Add(new Label { Text = "StandRig Connect", AutoSize = true, Font = new Font(Font.FontFamily, 18) });
        panel.Controls.Add(new Label { Text = "ネイティブ開発版。内包PNG・ArtMesh・画像・マスクの通常合成に対応。カメラ入力・Spout2送信に対応。", AutoSize = true });
        var diagnostics = new MenuStrip();
        var diagnosticMenu = new ToolStripMenuItem("診断（開発用）");
        diagnostics.Items.Add(diagnosticMenu);
        diagnosticMenu.DropDownItems.Add("GPU診断映像を表示（モデル描画を停止）", null, (_, _) => StartDiagnostic());
        var stop = new Button { Text = "停止", AutoSize = true }; stop.Click += (_, _) => Engine.Stop(TimeSpan.FromSeconds(2)); panel.Controls.Add(stop);
        var showOutput = new Button { Text = "出力画面を表示", AutoSize = true };
        showOutput.Click += (_,_) => { if(output != null){output.Show();output.WindowState=FormWindowState.Normal;} };
        panel.Controls.Add(showOutput);
        panel.Controls.Add(new Label { Text = "×でトレイへ格納します。終了はトレイメニューから行ってください。", AutoSize = true });
        var load = new ToolStripMenuItem("モデルJSONの計算のみ実行（モデル描画を停止）");
        load.Click += (_,_) => {
            using var dialog = new OpenFileDialog { Filter = "StandRig model (*.json)|*.json", CheckFileExists = true };
            if(dialog.ShowDialog()!=DialogResult.OK)return;
            StartModelEvaluation(dialog.FileName);
        };
        diagnosticMenu.DropDownItems.Add(load);
        var render=new Button {Text="モデルJSONを開く…",AutoSize=true};
        render.Click+=(_,_)=>{using var dialog=new OpenFileDialog{Filter="StandRig model (*.json)|*.json",CheckFileExists=true};if(dialog.ShowDialog()!=DialogResult.OK)return;try{StartModelRender(dialog.FileName);activeSlotId=null;}catch(Exception ex){MessageBox.Show(ex.Message);}};
        panel.Controls.Add(render);
        var spout=new CheckBox {Text="Spout2送信（StandRig Connect）",AutoSize=true};
        spout.CheckedChanged+=(_,_)=>SetSpoutEnabled(spout.Checked);
        var spoutState=new Label {AutoSize=true};panel.Controls.Add(spout);panel.Controls.Add(spoutState);
        refresh.Tick+=(_,_)=>{var code=Volatile.Read(ref ModelRenderPipeline.SpoutResult);var text=Volatile.Read(ref spoutEnabled)==0?"Spout2: OFF":!Engine.Status.Running?"Spout2: モデル描画を開始してください":code==0?"Spout2: 送信中（受信確認ではありません）":code==1?"Spout2: 待機中":$"Spout2: 送信不可 (0x{code:X8})。SDK付きビルドとGPUを確認してください。";var totals=Volatile.Read(ref ModelRenderPipeline.SpoutStatistics).Snapshot();text+=$" / 成功{totals.Succeeded}・失敗{totals.Failed}・未送信{totals.Skipped}";if(spoutState.Text!=text)spoutState.Text=text;};
        panel.Controls.Add(new Label {Text="OBS: ゲームキャプチャで Output — Model を選択し、透過を許可。ウィンドウキャプチャは Windows Graphics Capture 方式（背景は不透明）。操作画面は最小化可。出力画面は表示したままにしてください。",AutoSize=true,MaximumSize=new Size(520,0)});
        var demo=new CheckBox {Text="自動動作デモ（顔・体・目・口）",AutoSize=true};
        demo.CheckedChanged+=(_,_)=>Volatile.Write(ref demoEnabled,demo.Checked?1:0);
        panel.Controls.Add(demo);
        var idleChoices=new ComboBox{DropDownStyle=ComboBoxStyle.DropDownList,Width=220};
        idleChoices.Items.AddRange(new object[]{"待機なし","呼吸（ゆっくり）","呼吸＋ゆるい揺れ","呼吸＋ランダムな微動"});
        idleChoices.SelectedIndex=0;
        idleChoices.SelectedIndexChanged+=(_,_)=>{Volatile.Write(ref idlePreset,idleChoices.SelectedIndex);if(idleChoices.SelectedIndex>0)demo.Checked=false;};
        demo.CheckedChanged+=(_,_)=>{if(demo.Checked)idleChoices.SelectedIndex=0;};
        var idleControls=new FlowLayoutPanel{AutoSize=true,WrapContents=false};
        idleControls.Controls.Add(new Label{Text="待機モーション",AutoSize=true,Margin=new Padding(3,7,8,0)});
        idleControls.Controls.Add(idleChoices);
        panel.Controls.Add(new Label {Text="モデル描画中に切替可能。OFFで通常入力に戻ります。物理演算は継続します。",AutoSize=true});
        var motionControls=new FlowLayoutPanel {AutoSize=true,WrapContents=false};
        var openMotion=new Button {Text="モーション読込",AutoSize=true};
        openMotion.Click+=(_,_)=>{
            using var dialog=new OpenFileDialog {Filter="StandRig motion (*.json)|*.json",CheckFileExists=true};
            if(dialog.ShowDialog()!=DialogResult.OK)return;
            try{if(new FileInfo(dialog.FileName).Length>4*1024*1024)throw new ArgumentException("モーションは4 MiB以下にしてください");SendMotion(MotionAction.Load,File.ReadAllText(dialog.FileName));}catch(Exception ex){MessageBox.Show(ex.Message);}
        };
        motionControls.Controls.Add(openMotion);
        foreach(var item in new[]{("再生",MotionAction.Play),("一時停止",MotionAction.Pause),("モーション停止",MotionAction.Stop)}){
            var button=new Button {Text=item.Item1,AutoSize=true};button.Click+=(_,_)=>{try{SendMotion(item.Item2);}catch(Exception ex){MessageBox.Show(ex.Message);}};motionControls.Controls.Add(button);
        }
        var motionState=new Label {AutoSize=true,MaximumSize=new Size(520,0)};
        panel.Controls.Add(motionControls);panel.Controls.Add(motionState);
        var transport=new FlowLayoutPanel {AutoSize=true,WrapContents=false};
        var seek=new NumericUpDown {Minimum=0,Maximum=3600,DecimalPlaces=2,Increment=.1m,Width=85};
        var seekButton=new Button {Text="秒へ移動",AutoSize=true};
        seekButton.Click+=(_,_)=>{try{RequireMotion().Seek((double)seek.Value);}catch(Exception ex){MessageBox.Show(ex.Message);}};
        var speed=new NumericUpDown {Minimum=.1m,Maximum=4,DecimalPlaces=2,Increment=.1m,Value=1,Width=70};
        var loop=new CheckBox {Text="ループ",AutoSize=true};
        var apply=new Button {Text="速度・ループを適用",AutoSize=true};
        apply.Click+=(_,_)=>{try{RequireMotion().Configure((double)speed.Value,loop.Checked);}catch(Exception ex){MessageBox.Show(ex.Message);}};
        transport.Controls.AddRange(new Control[]{seek,seekButton,new Label{Text="速度（倍）",AutoSize=true},speed,loop,apply});
        panel.Controls.Add(transport);
        var trackingControls=new FlowLayoutPanel {AutoSize=true,WrapContents=false};
        trackingOn.CheckedChanged+=(_,_)=>Tracking?.SetEnabled(trackingOn.Checked);
        var neutral=new Button {Text="現在の姿勢を中立に",AutoSize=true};neutral.Click+=(_,_)=>Tracking?.CalibrateNeutral();
        var clearNeutral=new Button {Text="校正を解除",AutoSize=true};clearNeutral.Click+=(_,_)=>Tracking?.ClearCalibration();
        trackingControls.WrapContents=true;
        trackingControls.Controls.AddRange(new Control[]{trackingOn,neutral,clearNeutral});panel.Controls.Add(trackingControls);
        trackingSettings=new Form {Text="トラッキング調整",ClientSize=new Size(560,480),StartPosition=FormStartPosition.CenterParent,ShowInTaskbar=false};
        trackingSettings.FormClosing+=(_,e)=>{if(!AllowExit&&e.CloseReason==CloseReason.UserClosing){e.Cancel=true;trackingSettings.Hide();}};
        var adjustButton=new Button {Text="トラッキング調整…",AutoSize=true};

        trackingControls.Controls.Add(adjustButton);
        var adjustments=new FlowLayoutPanel {Dock=DockStyle.Fill,AutoScroll=true,Padding=new Padding(12),FlowDirection=FlowDirection.TopDown,WrapContents=false};
        adjustments.Controls.Add(new Label {AutoSize=true,MaximumSize=new Size(500,0),Text="顔・体・視線の左右は鏡の動きを想定した標準設定です。反転ONで標準方向の逆になります。強さ0倍は動きを無効化します。平滑化を上げると揺れが減り、反応が遅くなります。未対応項目は無効です。"});
        var smoothRow=new FlowLayoutPanel {AutoSize=true,WrapContents=false};
        var smoothLabel=new Label {AutoSize=true,Text="平滑化 0.15"};
        var smoothSlider=new TrackBar {Minimum=0,Maximum=95,Value=15,Width=230,Height=32,TickStyle=TickStyle.None};
        smoothRow.Controls.AddRange(new Control[]{smoothLabel,smoothSlider});adjustments.Controls.Add(smoothRow);
        var eyeClosedLabel=new Label {Text=$"目の閉じ判定 {DefaultTracking.EyeClosedDefault:F2}",Width=150};
        var eyeClosedSlider=new TrackBar {Minimum=0,Maximum=60,Value=(int)(DefaultTracking.EyeClosedDefault*100),Width=230,Height=32,TickStyle=TickStyle.None};
        var eyeClosedRow=new FlowLayoutPanel {AutoSize=true,WrapContents=false};eyeClosedRow.Controls.AddRange(new Control[]{eyeClosedLabel,eyeClosedSlider});adjustments.Controls.Add(eyeClosedRow);
        adjustments.Controls.Add(new Label {AutoSize=true,MaximumSize=new Size(500,0),Text="閉じきらない時は「目の閉じ判定」を上げます。目の開閉は平滑化せず即時反映します。"});
        var sliders=new List<(string Source,string Parameter,TrackBar Gain,CheckBox Invert,Label Label,bool DefaultInvert)>();
        bool resetting=false;
        void ApplyAdjustments(){if(resetting)return;foreach(var item in sliders)Tracking?.Adjust(item.Source,item.Gain.Value/100.0,item.Invert.Checked,smoothSlider.Value/100.0,eyeClosedSlider.Value/100.0);}
        foreach(var mapping in DefaultTracking.Mappings){
            var row=new FlowLayoutPanel {AutoSize=true,WrapContents=false};
            var label=new Label {Text=mapping.Label+" 1.00倍",Width=150};
            var gain=new TrackBar {Minimum=0,Maximum=300,Value=100,Width=230,Height=32,TickStyle=TickStyle.None};
            var invert=new CheckBox {Text="反転",AutoSize=true,Checked=false};
            gain.ValueChanged+=(_,_)=>{label.Text=mapping.Label+$" {gain.Value/100.0:F2}倍";ApplyAdjustments();};
            invert.CheckedChanged+=(_,_)=>ApplyAdjustments();
            sliders.Add((mapping.Source,mapping.Parameter,gain,invert,label,mapping.Invert));
            row.Controls.AddRange(new Control[]{label,gain,invert});adjustments.Controls.Add(row);
        }
        smoothSlider.ValueChanged+=(_,_)=>{smoothLabel.Text=$"平滑化 {smoothSlider.Value/100.0:F2}";ApplyAdjustments();};
        eyeClosedSlider.ValueChanged+=(_,_)=>{eyeClosedLabel.Text=$"目の閉じ判定 {eyeClosedSlider.Value/100.0:F2}";ApplyAdjustments();};
        resetTrackingSliders=()=>{resetting=true;try{smoothSlider.Value=15;eyeClosedSlider.Value=(int)(DefaultTracking.EyeClosedDefault*100);foreach(var item in sliders){item.Gain.Value=100;item.Invert.Checked=false;}}finally{resetting=false;}};
        captureTrackingControls=()=>new(sliders.ToDictionary(i=>i.Source,i=>new TrackingGain(i.Gain.Value/100.0,i.Invert.Checked)),smoothSlider.Value/100.0,eyeClosedSlider.Value/100.0,trackingOn.Checked);
        restoreTrackingControls=c=>{resetting=true;try{smoothSlider.Value=(int)Math.Round(c.Smoothing*100);eyeClosedSlider.Value=(int)Math.Round(c.EyeClosed*100);foreach(var item in sliders)if(c.Gains.TryGetValue(item.Source,out var gain)){item.Gain.Value=(int)Math.Round(gain.Gain*100);item.Invert.Checked=gain.Invert;}}finally{resetting=false;}};
        adjustments.Controls.Add(saveSlotTracking);adjustments.Controls.Add(trackingSlotStatus);
        trackingSettings.Controls.Add(adjustments);
        adjustButton.Click+=(_,_)=>{
            trackingSettings.WindowState=FormWindowState.Normal;
            adjustments.PerformLayout();
            var preferred=adjustments.GetPreferredSize(new Size(560,0));
            var work=Screen.FromControl(this).WorkingArea;
            var frame=trackingSettings.Size-trackingSettings.ClientSize;
            trackingSettings.ClientSize=new Size(Math.Min(Math.Max(560,preferred.Width),work.Width-frame.Width),Math.Min(preferred.Height+8,work.Height-frame.Height));
            trackingSettings.Show(this);
            trackingSettings.Location=new Point(Math.Clamp(Left+(Width-trackingSettings.Width)/2,work.Left,work.Right-trackingSettings.Width),Math.Clamp(Top+(Height-trackingSettings.Height)/2,work.Top,work.Bottom-trackingSettings.Height));
            trackingSettings.Activate();
        };
        string? displayedProfile=null;
        refresh.Tick+=(_,_)=>{
            var profile=Tracking?.State.ProfileJson;adjustments.Enabled=Tracking!=null&&Engine.Status.Running&&profile!=null;
            if(profile==displayedProfile)return;displayedProfile=profile;
            var supported=new HashSet<string>();
            if(profile!=null){using var doc=System.Text.Json.JsonDocument.Parse(profile);foreach(var mapping in doc.RootElement.GetProperty("tracking").GetProperty("mappings").EnumerateArray())supported.Add(mapping.GetProperty("source").GetString()!);}
            foreach(var item in sliders){item.Gain.Enabled=item.Invert.Enabled=supported.Contains(item.Source);}
        };
        var trackingState=new Label {AutoSize=true,MaximumSize=new Size(520,0)};panel.Controls.Add(trackingState);
        var cameraRow=new FlowLayoutPanel {AutoSize=true,WrapContents=false};
        var cameras=new ComboBox {DropDownStyle=ComboBoxStyle.DropDownList,Width=320};
        var refreshCameras=new Button {Text="カメラ一覧を更新",AutoSize=true};
        var cameraState=new Label {Text="未取得（カメラを選択してください）",AutoSize=true};
        async Task RefreshCameras(){
            if(!refreshCameras.Enabled || IsDisposed)return;
            string? selected=(cameras.SelectedItem as CameraDevice)?.SymbolicLink;
            refreshCameras.Enabled=false;cameraState.Text="デバイス確認中…";
            try{
                var devices=await Task.Run(CameraDevices.Enumerate);if(IsDisposed)return;
                cameras.Items.Clear();cameras.Items.AddRange(devices);
                int index=Array.FindIndex(devices,d=>d.SymbolicLink==selected);cameras.SelectedIndex=index>=0?index:devices.Length>0?0:-1;
                cameraState.Text=$"{devices.Length}台検出";
            }catch(Exception ex){if(!IsDisposed)cameraState.Text="カメラ一覧取得失敗: "+ex.Message;}
            finally{if(!IsDisposed)refreshCameras.Enabled=true;}
        }
        refreshCameras.Click+=async(_,_)=>await RefreshCameras();
        Shown+=async(_,_)=>{if(!testing)await RefreshCameras();};
        cameraRow.Controls.AddRange(new Control[]{cameras,refreshCameras});panel.Controls.Add(cameraRow);panel.Controls.Add(cameraState);
        var captureRow=new FlowLayoutPanel {AutoSize=true,WrapContents=false};
        var startCamera=new Button {Text="カメラ開始",AutoSize=true};var stopCamera=new Button {Text="カメラ停止",AutoSize=true};
        var enableInference=new CheckBox {Text="顔認識（開始時に適用）",AutoSize=true,Checked=true};
        var captureState=new Label {AutoSize=true,Text="撮影停止中"};
        startCamera.Click+=async(_,_)=>{
            if(cameras.SelectedItem is not CameraDevice device){MessageBox.Show("先にカメラを選択してください");return;}
            startCamera.Enabled=stopCamera.Enabled=false;
            try{await cameraCapture.StopAsync();if(IsDisposed)return;cameraCapture.Start(device,enableInference.Checked);}catch(Exception ex){if(!IsDisposed)MessageBox.Show(ex.Message);}finally{if(!IsDisposed)startCamera.Enabled=stopCamera.Enabled=true;}
        };
        stopCamera.Click+=async(_,_)=>{startCamera.Enabled=stopCamera.Enabled=false;try{await cameraCapture.StopAsync();}catch(Exception ex){MessageBox.Show(ex.Message);}finally{if(!IsDisposed)startCamera.Enabled=stopCamera.Enabled=true;}};
        captureRow.Controls.AddRange(new Control[]{startCamera,stopCamera,enableInference});panel.Controls.Add(captureRow);panel.Controls.Add(captureState);
        var faceInputs=new Label {AutoSize=true,MaximumSize=new Size(520,0)};panel.Controls.Add(faceInputs);
        refresh.Tick+=(_,_)=>{var c=cameraCapture.State;faceInputs.Text=cameraCapture.Running&&c.Face?.Count==1&&c.Inputs is {} values?string.Join(" / ",values.Where(p=>new[]{"faceYaw","facePitch","faceRoll","eyeLOpen","eyeROpen","mouthOpen"}.Contains(p.Key)).Select(p=>$"{p.Key}: {p.Value:F2}")):"顔入力なし（認識中に正面を向いて中立校正してください）";captureState.Text=$"カメラ: {(cameraCapture.Running?"撮影中":"停止")} / {c.Frames} frames / {c.Width}×{c.Height} / 顔{c.Face?.Count.ToString()??"未認識"} / {c.InferenceMs:F1}ms\n{c.Error??""}";};
        panel.Controls.Add(new Label {Text="モーションの指定項目を優先。一時停止は姿勢保持、停止は通常入力へ復帰。",AutoSize=true});
        var tabs=new TabControl {Dock=DockStyle.Fill,Enabled=!testing};
        void Page(string title,params Control[] controls){var page=new TabPage(title);var content=new FlowLayoutPanel {Dock=DockStyle.Fill,AutoScroll=true,FlowDirection=FlowDirection.TopDown,WrapContents=false,Padding=new Padding(16)};content.Controls.AddRange(controls);page.Controls.Add(content);tabs.TabPages.Add(page);}
        Label Help(string text)=>new(){Text=text,AutoSize=true,MaximumSize=new Size(520,0)};
        var currentModel=new Label {AutoSize=true,MaximumSize=new Size(520,0)};
        refresh.Tick+=(_,_)=>{var text=Volatile.Read(ref mode);if(currentModel.Text!=text)currentModel.Text=text;};
        Page("モデル",currentModel,Help("画像込みモデルJSONを開き、調整後はスロットへ保存してください。"),render,CreateModelSlots(),Help("×でトレイへ格納します。終了はトレイメニューから行ってください。"));
        var outputControls=new FlowLayoutPanel {AutoSize=true,WrapContents=true,MaximumSize=new Size(520,0)};
        outputControls.Controls.AddRange(new Control[]{showOutput,CreateOutputSettingsButton(),spout,stop});
        spoutState.MaximumSize=new Size(520,0);
        Page("配信",Help("カメラ・トラッキング"),cameraRow,cameraState,captureRow,captureState,trackingControls,trackingState,Help("OBSへの出力"),outputControls,spoutState,Help("Spout2: OBSのSpout2ソースで StandRig Connect を選択。出力画面は非表示でも送信できます。\nゲームキャプチャ: Output — Model を選び透過を許可。出力画面を表示しておきます。"));
        Page("モーション",idleControls,Help("待機は小さな動きです。目・口は操作せず、トラッキングと読込モーションを優先します。呼吸用パラメータがないモデルでは体の上下傾きを使います。"),demo,motionControls,motionState,transport,Help("モーションで指定した項目を優先します。一時停止は姿勢保持、停止で通常入力へ戻ります。"));
        Page("状態",state,faceInputs);
        if(!testing){
            string sessionFile=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"StandRigConnect","api-session.json");
            string apiStatus;
            try{parameterServer=new ParameterHttpServer(parameterControl,sessionFile);apiStatus="パラメータAPI: "+parameterServer.Url+"\n認証ファイル: "+sessionFile;}
            catch(Exception ex){apiStatus="パラメータAPI起動失敗: "+ex.Message;}
            Page("API",Help(apiStatus),Help("外部入力は指定項目のみを上書きし、期限切れ・解除で通常入力へ戻ります。認証ファイルは共有しないでください。手順: docs/PARAMETER-API.md"));
        }
        panel.Dispose();Controls.Add(tabs);Controls.Add(diagnostics);MainMenuStrip=diagnostics;diagnostics.Enabled=!testing;
        var menu = new ContextMenuStrip(); menu.Items.Add("操作画面を表示", null, (_, _) => { Show(); WindowState = FormWindowState.Normal; Activate(); });
        menu.Items.Add("処理を停止", null, (_, _) => Engine.Stop(TimeSpan.FromSeconds(2)));
        menu.Items.Add("終了", null, (_, _) => { AllowExit = true; Close(); });
        tray = new NotifyIcon { Icon = SystemIcons.Application, Text = "StandRig Connect", Visible = !testing, ContextMenuStrip = menu };
        tray.DoubleClick += (_, _) => { Show(); WindowState = FormWindowState.Normal; };
        refresh.Tick += (_, _) => { var s = Engine.Status; state.Text = $"処理ループ: {(s.Running ? "動作中" : "停止")} / ticks: {s.Ticks}\nエラー: {s.Error ?? "なし"}\n{Volatile.Read(ref mode)}"; };
        refresh.Start();
        refresh.Tick+=(_,_)=>{
            motionControls.Enabled=Motion!=null&&Engine.Status.Running;
            transport.Enabled=motionControls.Enabled;
            trackingControls.Enabled=Tracking!=null&&Engine.Status.Running;
            var t=Tracking?.State;
            trackingState.Text=$"トラッキング: {(t?.Active==true?"入力反映中":t?.Loaded==true?"入力待ち":"設定未読込")} / カメラ開始・顔認識・有効化でモデルへ反映\n{t?.Error??""}";
            var m=Motion?.State;
            var motionText=m==null?"モーション: モデル描画を開始してください":$"モーション: {m.Name??"未読込"} / {m.Time:F2} / {m.Duration:F2}秒 / {(m.Running?"再生中":m.Active?"姿勢保持":"停止")} / {m.Speed:F2}倍 / ループ{(m.Loop?"ON":"OFF")}";
            if(!string.IsNullOrEmpty(m?.Error))motionText+="\n"+m.Error;
            if(motionState.Text!=motionText)motionState.Text=motionText;
        };
    }
    internal CameraCaptureState CameraState=>cameraCapture.State;
    internal long RecognizedFrames=>cameraCapture.RecognizedFrames;
    internal object? CameraResources=>cameraCapture.Resources;
    internal async Task StartTestCamera(string profile,string deviceName){
        if(new FileInfo(profile).Length>1024*1024)throw new ArgumentException("Profile too large");
        Tracking!.LoadProfile(File.ReadAllText(profile));Tracking.SetEnabled(true);
        var devices=await Task.Run(CameraDevices.Enumerate);
        cameraCapture.Start(devices.Single(d=>d.Name==deviceName),true);
    }
    internal Task<bool> StopTestCamera()=>cameraCapture.StopAsync();
    internal void SetSpoutEnabled(bool value)=>Volatile.Write(ref spoutEnabled,value?1:0);
    internal void EnableSpout(bool hideOutput=true){Volatile.Write(ref spoutEnabled,1);if(hideOutput)output?.Hide();}
    internal void EnableDemo()=>Volatile.Write(ref demoEnabled,1);
    internal void SendMotion(MotionAction action,string? json=null){if(Motion==null||!Engine.Status.Running)throw new InvalidOperationException("先にモデルのD3D描画を開始してください");Motion.Submit(action,json);}
    private MotionPlayback RequireMotion(){if(Motion==null||!Engine.Status.Running)throw new InvalidOperationException("先にモデルのD3D描画を開始してください");return Motion;}
    internal void StartModelEvaluation(string path)
    {
        if(!Engine.Stop(TimeSpan.FromSeconds(2))) throw new InvalidOperationException("Previous worker did not stop");
        Motion=null;
        Tracking=null;
        output?.Hide();Volatile.Write(ref mode,"モデル読込中（評価のみ）");
        Engine.Start(()=>new ModelEvaluationPipeline(path, text=>Volatile.Write(ref mode,text)));
    }
    internal void StartDiagnostic()
    {
        if (!Engine.Stop(TimeSpan.FromSeconds(2))) return;
        Motion=null;
        Tracking=null;
        Volatile.Write(ref mode,"GPU診断映像（モデル描画ではありません）");
        EnsureOutput();
        output!.Text="StandRig Connect Output — Diagnostic";
        if (!testing) output.Show();
        nint window = output.Handle;
        Engine.Start(() => new GpuDiagnosticPipeline(window, () => Volatile.Read(ref presentationEnabled) == 1, testing));
    }
    internal void StartModelRender(string path,string? capture=null,bool physics=true,bool benchmarkMotion=false,string? modelJson=null,string? initialTrackingProfile=null,TrackingControlsSnapshot? controls=null)
    {
        if(!Engine.Stop(TimeSpan.FromSeconds(2)))throw new InvalidOperationException("Previous worker did not stop");
        EnsureOutput();FitOutputWindow();output!.Text="StandRig Connect Output — Model";
        if(!testing)output.Show();nint window=output.Handle;
        Volatile.Write(ref loadedModelJson,null);
        Volatile.Write(ref mode,"モデル描画準備中");
        var playback=new MotionPlayback();Motion=playback;
        var tracking=new TrackingPlayback();Tracking=tracking;resetTrackingSliders?.Invoke();trackingOn.Checked=!testing;tracking.SetEnabled(!testing);
        if(controls!=null){restoreTrackingControls?.Invoke(controls);trackingOn.Checked=controls.Enabled;tracking.SetEnabled(controls.Enabled);}
        Engine.Start(()=>new ModelRenderPipeline(path,window,()=>Volatile.Read(ref presentationEnabled)==1,text=>Volatile.Write(ref mode,text),capture,physics,benchmarkMotion,()=>Volatile.Read(ref demoEnabled)==1,playback,tracking,()=>Volatile.Read(ref spoutEnabled)==1,autoTracking:!testing,modelJson:modelJson,initialTrackingProfile:initialTrackingProfile,modelReady:json=>Volatile.Write(ref loadedModelJson,json),idlePreset:()=> (IdlePreset)Volatile.Read(ref idlePreset),parameterControl:parameterControl,outputView:()=>Volatile.Read(ref outputView)));
    }
    private void EnsureOutput()
    {
        if (output == null)
        {
            output = new Form { Text = "StandRig Connect Output — Diagnostic", ClientSize = new Size(640,480), FormBorderStyle = FormBorderStyle.FixedSingle, MaximizeBox = false, ShowInTaskbar = !testing };
            ConfigureOutputGestures(output);
            output.Resize += (_,_) => Volatile.Write(ref presentationEnabled, output.WindowState == FormWindowState.Minimized ? 0 : 1);
            output.VisibleChanged += (_,_) => Volatile.Write(ref presentationEnabled, output.Visible && output.WindowState != FormWindowState.Minimized ? 1 : 0);
            output.FormClosing += (_,e) => { if (!AllowExit) { e.Cancel=true;output.Hide(); } };
        }
    }
    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (!AllowExit && e.CloseReason == CloseReason.UserClosing) { e.Cancel = true; Hide(); return; }
        if (!Engine.Stop(TimeSpan.FromSeconds(2))) { e.Cancel = true; MessageBox.Show("処理が停止していません。終了を再試行してください。"); return; }
        base.OnFormClosing(e);
    }
    protected override void Dispose(bool disposing)
    {
        if (disposing) { FlushOutputSettings();outputSaveTimer?.Dispose();outputSettings?.Dispose();parameterServer?.Dispose(); refresh.Dispose(); tray.Dispose(); cameraCapture.Dispose();Engine.Dispose(); trackingSettings?.Dispose(); output?.Dispose(); }
        base.Dispose(disposing);
    }
}
