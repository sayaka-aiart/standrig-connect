using System.Diagnostics;
using System.Text.Json;
using StandRig.Connect;
using StandRig.Connect.Audio;
internal static class LipSyncChecks
{
    public static void Run()
    {
        static void Check(bool value,string name){if(!value)throw new Exception(name);Console.WriteLine("PASS "+name);}
        using var fixture=JsonDocument.Parse(File.ReadAllText("scripts/audio/mfcc-reference.json"));var analyzer=new MfccAnalyzer();var features=new Dictionary<string,AudioFeatures>();
        foreach(var entry in fixture.RootElement.GetProperty("cases").EnumerateArray()){
            var wave=new float[1024];uint seed=0x12345678;
            for(int i=0;i<wave.Length;i++){seed=unchecked(seed*1664525+1013904223);double value=entry.GetProperty("tones").EnumerateArray().Sum(t=>t[1].GetDouble()*Math.Sin(2*Math.PI*t[0].GetDouble()*i/16000));value+=((seed>>8)/16777216d*2-1)*entry.GetProperty("noise").GetDouble();wave[i]=(float)value;}
            var actual=analyzer.Analyze(wave);var expected=entry.GetProperty("mfcc").EnumerateArray().Select(v=>v.GetDouble()).ToArray();
            Check(Math.Abs(actual.Rms-entry.GetProperty("rms").GetDouble())<1e-10&&actual.Mfcc.Zip(expected,(a,b)=>Math.Abs(a-b)<1e-5*Math.Max(1,Math.Abs(b))).All(v=>v),"MFCC reference parity "+entry.GetProperty("name").GetString());features[entry.GetProperty("name").GetString()!]=actual;
        }
        var invalid=new float[1024];invalid[0]=float.NaN;try{analyzer.Analyze(invalid);throw new Exception("NaN accepted");}catch(ArgumentException){}
        var stream=new AudioFeatureStream();int frames=0;stream.Push(new float[16000],f=>{frames++;if(!f.Mfcc.All(double.IsFinite))throw new Exception("Nonfinite silence");});Check(frames==47,"bounded ring, warmup and 20ms analysis hops");
        var source=Enumerable.Range(0,4800).Select(i=>(float)Math.Sin(i*2*Math.PI*440/48000)).ToArray();var whole=new List<float>();var split=new List<float>();new AudioResampler(48000).Push(source,whole.Add);var chunks=new AudioResampler(48000);chunks.Push(source.AsSpan(0,123),split.Add);chunks.Push(source.AsSpan(123,456),split.Add);chunks.Push(source.AsSpan(579),split.Add);Check(whole.SequenceEqual(split)&&whole.Count==1600,"streaming resampler is packet-independent at 48kHz");
        var stopband=new List<float>();new AudioResampler(48000).Push(Enumerable.Range(0,4800).Select(i=>(float)Math.Sin(i*2*Math.PI*12000/48000)).ToArray(),stopband.Add);Check(stopband.Skip(100).Select(x=>x*(double)x).Average()<.001,"downsampling rejects frequencies above target Nyquist");
        double clock=0;var control=new LipSyncControl(()=>clock);control.BeginInput();
        foreach(string id in LipSyncProfile.VowelIds){control.BeginCalibration(id);clock+=.4;for(int i=0;i<61;i++){control.Feed(features[id]);clock+=.02;}clock+=.05;control.Snapshot();}
        Check(control.Snapshot().Ready,"five vowels calibrate using voiced frames");
        var profile=control.Settings().Profile;foreach(string id in LipSyncProfile.VowelIds)Check(profile.Classify(features[id].Mfcc).MaxBy(p=>p.Value).Key==id,"synthetic calibrated vowel "+id);
        using var rig=JsonDocument.Parse(File.ReadAllText("scripts/evaluation/facial-fixture.json"));var facial=new FacialControl();facial.Load("model",rig.RootElement.GetProperty("facialPresets").GetRawText());
        control.Enable(facial.Snapshot());control.Feed(features["A"]);using(var command=JsonDocument.Parse(control.RenderCommand(facial.Snapshot())!))Check(command.RootElement.GetProperty("weights").GetProperty("A").GetDouble()>.99,"audio weights reach renderer boundary");
        control.Feed(features["silence"]);using(var command=JsonDocument.Parse(control.RenderCommand(facial.Snapshot())!))Check(command.RootElement.GetProperty("weights").GetProperty("Silence").GetDouble()==1,"silence owns closed mouth instead of restoring camera");
        facial.Submit("model","{\"action\":\"expression\",\"id\":\"half\"}");control.Feed(features["I"]);Check(control.RenderCommand(facial.Snapshot())!=null&&control.Snapshot().Enabled,"expressions coexist with audio");
        facial.Submit("model","{\"action\":\"viseme\",\"id\":\"A\"}");Check(control.RenderCommand(facial.Snapshot())==null&&!control.Snapshot().Enabled,"manual/API vowel command suspends audio without clearing manual layer");
        control.Configure(control.Settings() with{DelayMs=200});control.Enable(facial.Snapshot());control.Feed(features["E"]);using(var initial=JsonDocument.Parse(control.RenderCommand(facial.Snapshot())!))Check(initial.RootElement.GetProperty("weights").GetProperty("Silence").GetDouble()==1,"delay starts with Silence");
        clock+=.199;Check(control.RenderCommand(facial.Snapshot())==null,"audio does not render before requested delay");clock+=.002;Check(control.RenderCommand(facial.Snapshot())!=null,"due audio weights are rendered");
        clock+=.6;Check(control.RenderCommand(facial.Snapshot())!.Contains("clear")&&!control.Snapshot().Enabled,"missing audio releases mouth safely");
        control.Configure(control.Settings() with{DelayMs=2000});control.Enable(facial.Snapshot());for(int i=0;i<300;i++){clock+=.001;control.Feed(features["A"]);}Check(control.Snapshot().Pending<=128,"delayed weights have a bounded backlog");
        control.ModelStopped("model");Check(!control.Snapshot().Enabled&&control.RenderCommand(facial.Snapshot())==null,"model stop clears automatic output without leaking into next model");
        control.BeginCalibration("A");clock+=2;control.Feed(features["silence"]);Check(control.Settings().Profile.Vowels["A"].SequenceEqual(profile.Vowels["A"]),"failed/noise-gated calibration preserves previous profile");
        var file=Path.Combine(Path.GetTempPath(),"standrig-lipsync-"+Guid.NewGuid().ToString("N")+".json");control.Settings().Save(file);Check(LipSyncSettings.Load(file).Profile.Ready&&new FileInfo(file).Length<32768,"settings/profile persist without audio recording");
        var timer=Stopwatch.StartNew();for(int i=0;i<500;i++)analyzer.Analyze(source.AsSpan(0,1024));Console.WriteLine($"MFCC analysis mean {timer.Elapsed.TotalMilliseconds/500:F3} ms (local CPU only)");
    }
}
