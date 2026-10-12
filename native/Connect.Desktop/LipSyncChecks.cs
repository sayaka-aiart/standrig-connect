using System.Buffers.Binary;
using System.Text.Json;
using NAudio.Wave;
using StandRig.Connect;
using StandRig.Connect.Audio;
namespace StandRig.Connect.Desktop;

internal static class LipSyncChecks
{
    internal static void Run(string model,string report)
    {
        report=Path.GetFullPath(report);Directory.CreateDirectory(Path.GetDirectoryName(report)!);
        using var window=new MainWindow(true);
        window.Shown+=async(_,_)=>{
            CancellationTokenSource? stopProducer=null;Task? producer=null;
            try{
                // Test PCM decoder without activating a recording device.
                foreach(int bits in new[]{16,24,32}){
                    var format=new WaveFormat(48000,bits,2);var pcm=new byte[format.BlockAlign*2];int size=bits/8;
                    for(int channel=0;channel<2;channel++){int offset=channel*size;if(bits==16)BinaryPrimitives.WriteInt16LittleEndian(pcm.AsSpan(offset),16384);else if(bits==32)BinaryPrimitives.WriteInt32LittleEndian(pcm.AsSpan(offset),1073741824);else pcm[offset+2]=64;}
                    var decoded=new float[2];AudioInput.Decode(pcm,format,decoded);if(decoded[0]!=.5f||decoded[1]!=0)throw new Exception("PCM decode "+bits);
                }
                var floatFormat=WaveFormat.CreateIeeeFloatWaveFormat(48000,2);
                using var reference=JsonDocument.Parse(File.ReadAllText("scripts/audio/mfcc-reference.json"));
                var tones=reference.RootElement.GetProperty("cases").EnumerateArray().Where(e=>LipSyncProfile.VowelIds.Contains(e.GetProperty("name").GetString())).ToDictionary(e=>e.GetProperty("name").GetString()!,e=>e.GetProperty("tones").EnumerateArray().Select(t=>(Frequency:t[0].GetDouble(),Amplitude:t[1].GetDouble())).ToArray());
                byte[] Packet(string id,long start){var bytes=new byte[960*8];for(int i=0;i<960;i++){float value=id=="Silence"?0:(float)tones[id].Sum(t=>t.Amplitude*Math.Sin(2*Math.PI*t.Frequency*(start+i)/48000));for(int c=0;c<2;c++)BinaryPrimitives.WriteInt32LittleEndian(bytes.AsSpan(i*8+c*4),BitConverter.SingleToInt32Bits(value));}return bytes;}
                var profile=LipSyncProfile.Empty();
                foreach(string id in LipSyncProfile.VowelIds){var stream=new AudioFeatureStream();var resample=new AudioResampler(48000);var buffer=new float[320];int written=0,count=0;var average=new double[12];
                    for(int p=0;p<75;p++){var mono=new float[960];AudioInput.Decode(Packet(id,p*960),floatFormat,mono);resample.Push(mono,value=>{buffer[written++]=value;if(written==buffer.Length){stream.Push(buffer,f=>{if(count++>10)for(int c=0;c<12;c++)average[c]+=f.Mfcc[c];});written=0;}});}
                    for(int c=0;c<12;c++)average[c]/=count-11;profile.Vowels[id]=average;
                }
                window.LipSync.Configure(new(null,profile));window.StartModelRender(model,Path.ChangeExtension(report,"png"),physics:false);
                async Task Wait(Func<bool> condition){for(int i=0;i<1600;i++){if(window.Engine.Status.Error!=null)throw new Exception(window.Engine.Status.Error);if(condition())return;await Task.Delay(25);}throw new TimeoutException("Lip sync test timeout");}
                await Wait(()=>window.Facial.Snapshot().ModelSession!=null&&window.Engine.Status.Ticks>=4);
                string phoneme="A";stopProducer=new();var token=stopProducer.Token;
                window.LipSync.BeginInput();
                producer=Task.Run(async()=>{var stream=new AudioFeatureStream();var resample=new AudioResampler(48000);var buffer=new float[320];int written=0;long position=0;while(!token.IsCancellationRequested){var mono=new float[960];AudioInput.Decode(Packet(Volatile.Read(ref phoneme),position),floatFormat,mono);position+=mono.Length;resample.Push(mono,value=>{buffer[written++]=value;if(written==buffer.Length){stream.Push(buffer,window.LipSync.Feed);written=0;}});await Task.Delay(20,token);}},token);
                await Wait(()=>window.LipSync.Snapshot().Frames>3);window.LipSync.Enable(window.Facial.Snapshot());window.EnableSpout();
                await Task.Delay(600);if(window.TestParameters.Snapshot().InputValues["ParamMouthOpen"]<.95)throw new Exception("Synthetic A not rendered");
                window.Engine.Submit(new PoseFrame(1,new Dictionary<string,double>{{"ParamEyeLOpen",.8}}));await Wait(()=>window.Engine.Status.AppliedSequence==1);
                var tabs=window.Controls.OfType<TabControl>().Single();tabs.Enabled=true;tabs.SelectedTab=tabs.TabPages.Cast<TabPage>().Single(p=>p.Text=="リップシンク");await Task.Delay(300);
                using(var bitmap=new Bitmap(window.ClientSize.Width,window.ClientSize.Height)){window.DrawToBitmap(bitmap,new Rectangle(Point.Empty,bitmap.Size));bitmap.Save(Path.Combine(Path.GetDirectoryName(report)!,"lipsync-ui.png"));}
                static IEnumerable<Control> Descendants(Control parent){foreach(Control child in parent.Controls){yield return child;foreach(var descendant in Descendants(child))yield return descendant;}}
                Descendants(tabs.SelectedTab!).OfType<Button>().Single(b=>b.Text=="音量・遅延を調整…").PerformClick();await Task.Delay(150);
                var settingsWindow=window.OwnedForms.Single(f=>f.Text=="リップシンク：音量・遅延");using(var bitmap=new Bitmap(settingsWindow.Width,settingsWindow.Height)){settingsWindow.DrawToBitmap(bitmap,new Rectangle(Point.Empty,bitmap.Size));bitmap.Save(Path.Combine(Path.GetDirectoryName(report)!,"lipsync-settings-ui.png"));}settingsWindow.Close();
                window.Facial.Submit(window.Facial.Snapshot().ModelSession!,"{\"action\":\"expression\",\"id\":\"half\"}");await Task.Delay(300);if(Math.Abs(window.TestParameters.Snapshot().InputValues["ParamEyeLOpen"]-.4)>1e-8||!window.LipSync.Snapshot().Enabled)throw new Exception("Expression did not coexist with audio");
                Volatile.Write(ref phoneme,"Silence");await Task.Delay(800);if(window.TestParameters.Snapshot().InputValues["ParamMouthOpen"]>.01)throw new Exception("Silence did not close mouth");
                Volatile.Write(ref phoneme,"I");window.WindowState=FormWindowState.Minimized;window.Hide();long ticks=window.Engine.Status.Ticks;await Task.Delay(900);double mouth=window.TestParameters.Snapshot().InputValues["ParamMouthOpen"];
                if(Math.Abs(mouth-.3)>.05||window.Engine.Status.Ticks<=ticks+20)throw new Exception("Hidden audio/render loop failed: "+mouth);
                window.Facial.Submit(window.Facial.Snapshot().ModelSession!,"{\"action\":\"viseme\",\"id\":\"A\"}");await Wait(()=>!window.LipSync.Snapshot().Enabled);await Task.Delay(500);if(window.TestParameters.Snapshot().InputValues["ParamMouthOpen"]<.99)throw new Exception("Manual vowel did not retain priority");
                stopProducer.Cancel();try{await producer;}catch(OperationCanceledException){}window.LipSync.StopInput();
                var audio=window.LipSync.Snapshot();if(!window.Engine.Stop(TimeSpan.FromSeconds(2)))throw new Exception("Render worker stop failed");var sending=Volatile.Read(ref ModelRenderPipeline.SpoutStatistics).Snapshot();if(sending.Succeeded==0||sending.Failed!=0)throw new Exception("Spout audio output failed");
                File.WriteAllText(report,JsonSerializer.Serialize(new{passed=true,syntheticAudio=true,microphoneOpened=false,pcmDecoder=true,fullAudioToRenderer=true,minimized=true,manualOverride=true,spout=sending,audio}));
            }catch(Exception e){File.WriteAllText(report,JsonSerializer.Serialize(new{passed=false,error=e.ToString()}));Environment.ExitCode=1;}
            finally{stopProducer?.Cancel();if(producer!=null)try{await producer;}catch(OperationCanceledException){}stopProducer?.Dispose();window.AllowExit=true;window.Close();}
        };
        Application.Run(window);
    }
}
