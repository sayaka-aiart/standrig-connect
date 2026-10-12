using System.Net;
using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using StandRig.Connect;
using StandRig.Connect.Evaluation;
namespace StandRig.Connect.Desktop;
internal static class FacialRenderChecks
{
    public static void Run(string model,string report,bool spout=false)
    {
        report=Path.GetFullPath(report);Directory.CreateDirectory(Path.GetDirectoryName(report)!);
        using var window=new MainWindow(true);
        window.Shown+=async(_,_)=>{
            ParameterHttpServer? server=null;
            try{
                string capture=Path.ChangeExtension(report,"png");window.StartModelRender(model,capture,physics:false);
                async Task Wait(Func<bool> condition){for(int i=0;i<1600;i++){if(window.Engine.Status.Error!=null)throw new Exception(window.Engine.Status.Error);if(condition())return;await Task.Delay(25);}throw new TimeoutException("Facial render test condition timed out: "+JsonSerializer.Serialize(new {engine=window.Engine.Status,facial=window.Facial.Snapshot()}));}
                await Wait(()=>window.Facial.Snapshot().ModelSession!=null&&window.Engine.Status.Ticks>=4);
                var session=window.Facial.Snapshot().ModelSession!;
                var listener=new TcpListener(IPAddress.Loopback,0);listener.Start();int port=((IPEndPoint)listener.LocalEndpoint).Port;listener.Stop();
                string file=Path.Combine(Path.GetDirectoryName(report)!,"test-api-session.json");server=new ParameterHttpServer(window.TestParameters,file,port,window.Facial);
                using var http=new HttpClient{BaseAddress=new Uri(server.Url)};using var credentials=JsonDocument.Parse(File.ReadAllText(file));http.DefaultRequestHeaders.Authorization=new AuthenticationHeaderValue("Bearer",credentials.RootElement.GetProperty("token").GetString());
                async Task Face(object command){using var response=await http.PostAsync("/api/v1/facial",new StringContent(JsonSerializer.Serialize(new{modelSession=session,command}),Encoding.UTF8,"application/json"));if(response.StatusCode!=HttpStatusCode.Accepted)throw new Exception("Facial HTTP command rejected");using var ack=JsonDocument.Parse(await response.Content.ReadAsStringAsync());long sequence=ack.RootElement.GetProperty("sequence").GetInt64();await Wait(()=>window.Facial.Snapshot().AppliedSequence>=sequence);}
                long poseSequence=0;
                async Task Capture(string name){window.Engine.Submit(new PoseFrame(++poseSequence,new Dictionary<string,double>{{"ParamEyeLOpen",.8},{"ParamEyeROpen",.6},{"ParamMouthOpen",.2}}));await Wait(()=>window.Engine.Status.AppliedSequence>=poseSequence);File.Copy(Path.Combine(Path.GetDirectoryName(capture)!,Path.GetFileNameWithoutExtension(capture)+"-pose.png"),Path.Combine(Path.GetDirectoryName(report)!,name+".png"),true);}
                await Capture("neutral");if(spout)window.EnableSpout();await Face(new{action="expression",id="half"});await Face(new{action="viseme",id="A"});await Task.Delay(350);await Capture("half-eyes-and-A");
                var input=window.TestParameters.Snapshot().InputValues;
                if(Math.Abs(input["ParamEyeLOpen"]-.4)>1e-8||Math.Abs(input["ParamEyeROpen"]-.3)>1e-8||input["ParamMouthOpen"]!=1)throw new Exception("Native composed pose mismatch");
                var tabs=window.Controls.OfType<TabControl>().Single();tabs.Enabled=true;tabs.SelectedTab=tabs.TabPages.Cast<TabPage>().Single(p=>p.Text=="表情・母音");await Task.Delay(300);
                static IEnumerable<Control> Descendants(Control parent){foreach(Control child in parent.Controls){yield return child;foreach(var descendant in Descendants(child))yield return descendant;}}
                var facialPage=tabs.SelectedTab!;
                async Task Click(string label){long sequence=window.Facial.Snapshot().AcceptedSequence;Descendants(facialPage).OfType<Button>().Single(b=>b.Text==label).PerformClick();await Wait(()=>window.Facial.Snapshot().AppliedSequence>sequence);await Task.Delay(250);}
                await Click("母音を解除");if(window.TestParameters.Snapshot().InputValues["ParamMouthOpen"]!=.2)throw new Exception("UI vowel clear failed");
                await Click("あ");if(window.TestParameters.Snapshot().InputValues["ParamMouthOpen"]!=1)throw new Exception("UI vowel selection failed");
                var strength=Descendants(facialPage).OfType<TrackBar>().Single();strength.Value=50;await Task.Delay(300);
                if(Math.Abs(window.TestParameters.Snapshot().InputValues["ParamEyeLOpen"]-.6)>1e-8)throw new Exception("UI expression strength failed");
                strength.Value=100;await Task.Delay(300);
                await Click("表情を解除");if(window.TestParameters.Snapshot().InputValues["ParamEyeLOpen"]!=.8)throw new Exception("UI expression clear failed");
                await Click("表情を適用");if(Math.Abs(window.TestParameters.Snapshot().InputValues["ParamEyeLOpen"]-.4)>1e-8)throw new Exception("UI expression select failed");
                using(var bitmap=new Bitmap(window.ClientSize.Width,window.ClientSize.Height)){window.DrawToBitmap(bitmap,new Rectangle(Point.Empty,bitmap.Size));bitmap.Save(Path.Combine(Path.GetDirectoryName(report)!,"facial-ui.png"));}
                using(var fixtureEvaluator=new ModelEvaluator()){
                    using var meta=JsonDocument.Parse(fixtureEvaluator.Load(File.ReadAllText(model)));
                    window.Tracking!.LoadProfile(DefaultTracking.Adjust(DefaultTracking.Create(meta.RootElement.GetProperty("parameters")),new Dictionary<string,(double Gain,bool Invert)>(),0));
                }
                window.Tracking!.SetEnabled(true);window.Tracking.Submit(1,new Dictionary<string,double>{{"mouthOpen",.6}});await Task.Delay(75);
                if(window.TestParameters.Snapshot().InputValues["ParamMouthOpen"]!=1)throw new Exception("Tracked mouth displaced selected viseme");
                await Face(new{action="clear",layer="viseme"});await Task.Delay(125);
                if(Math.Abs(window.TestParameters.Snapshot().InputValues["ParamMouthOpen"]-.6)>1e-8)throw new Exception("Viseme clear did not restore tracking input: "+window.TestParameters.Snapshot().InputValues["ParamMouthOpen"]);
                window.Tracking.SetEnabled(false);await Face(new{action="viseme",id="A"});await Task.Delay(125);
                window.SendMotion(MotionAction.Load,"{\"format\":\"standrig-motion\",\"version\":1,\"name\":\"facial-test\",\"duration\":2,\"tracks\":[{\"parameter\":\"ParamMouthOpen\",\"keys\":[{\"time\":0,\"value\":0.3},{\"time\":2,\"value\":0.3}]}]}");window.SendMotion(MotionAction.Play);await Task.Delay(150);
                await Face(new{action="clear",layer="viseme"});await Task.Delay(150);if(Math.Abs(window.TestParameters.Snapshot().InputValues["ParamMouthOpen"]-.3)>1e-8)throw new Exception("Cleared viseme did not restore live motion");
                await Face(new{action="viseme",id="A"});await Task.Delay(150);
                using(var overrideResponse=await http.PostAsync("/api/v1/parameters/set",new StringContent(JsonSerializer.Serialize(new{modelSession=session,values=new{ParamMouthOpen=.25},ttlMs=500}),Encoding.UTF8,"application/json"))){overrideResponse.EnsureSuccessStatusCode();}
                await Task.Delay(100);if(window.TestParameters.Snapshot().InputValues["ParamMouthOpen"]!=.25)throw new Exception("Native raw API priority failed");
                window.WindowState=FormWindowState.Minimized;window.Hide();long ticks=window.Engine.Status.Ticks;await Task.Delay(650);
                if(window.Engine.Status.Ticks<=ticks+10||window.TestParameters.Snapshot().InputValues["ParamMouthOpen"]!=1)throw new Exception("Hidden renderer/facial fade or override expiry failed");
                await Face(new{action="clear",immediate=true});await Task.Delay(50);if(window.TestParameters.Snapshot().InputValues["ParamEyeLOpen"]!=.8)throw new Exception("Clear did not restore base eyes");
                if(spout){var sending=Volatile.Read(ref ModelRenderPipeline.SpoutStatistics).Snapshot();if(sending.Attempts==0||sending.Failed!=0||sending.Skipped!=0)throw new Exception("Spout facial sender failed");}
                var final=window.Facial.Snapshot();if(!window.Engine.Stop(TimeSpan.FromSeconds(2)))throw new Exception("Worker did not stop");if(window.Facial.Snapshot().ModelSession!=null)throw new Exception("Stopped model retains facial session");
                File.WriteAllText(report,JsonSerializer.Serialize(new{passed=true,cameraOpened=false,syntheticTrackingCoexists=true,apiToNativeRenderer=true,uiButtonsAndStrength=true,liveMotionRestoration=true,rawApiPriority=true,minimizedAndHidden=true,facial=final,timing=window.Engine.Timing,spoutSent=spout,spout=Volatile.Read(ref ModelRenderPipeline.SpoutStatistics).Snapshot()}));
            }catch(Exception e){File.WriteAllText(report,JsonSerializer.Serialize(new{passed=false,error=e.ToString()}));Environment.ExitCode=1;}
            finally{server?.Dispose();window.AllowExit=true;window.Close();}
        };
        Application.Run(window);
    }
}
internal sealed partial class MainWindow{internal ParameterControl TestParameters=>parameterControl;}
