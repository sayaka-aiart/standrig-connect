using System.Diagnostics;
using System.Text.Json;
namespace StandRig.Connect.Audio;

public sealed record LipSyncStatus(bool InputRunning,bool Enabled,long Frames,double LevelDb,string? Vowel,Dictionary<string,double> Weights,string? Calibrating,double CalibrationRemaining,string Message,int Pending,long ProfileRevision,bool Ready);

// Analysis and capture are independent of the render/UI clocks. Only a bounded
// queue of vowel weights crosses to the renderer; no audio or HTTP backlog.
public sealed class LipSyncControl
{
    private readonly object gate=new();
    private readonly Func<double> now;
    private readonly Queue<(double Due,Dictionary<string,double> Weights)> pending=new();
    private LipSyncSettings settings=LipSyncSettings.Defaults();
    private bool input,enabled,release,initial;
    private string? session,calibrating,vowel;
    private long manualVersion,frames,profileRevision;
    private double lastFrame,levelDb=-120,calStart,calEnd;
    private readonly List<double[]> calibration=new();
    private Dictionary<string,double> weights=new();
    private string message="音声入力は停止中です。";
    public LipSyncControl(Func<double>? clock=null)=>now=clock??(()=>Stopwatch.GetTimestamp()/(double)Stopwatch.Frequency);
    public LipSyncSettings Settings(){lock(gate)return settings with{Profile=settings.Profile.Copy()};}
    public void Configure(LipSyncSettings value)
    {
        value.Validate();lock(gate){bool changedDelay=settings.DelayMs!=value.DelayMs;settings=value with{Profile=value.Profile.Copy()};if(changedDelay)pending.Clear();if(!settings.Profile.Ready)Disable(false);profileRevision++;}
    }
    public void BeginInput(){lock(gate){input=true;frames=0;lastFrame=now();levelDb=-120;weights.Clear();vowel=null;message="校正する母音を選び、発声してください。";}}
    public void StopInput(string? error=null){lock(gate){input=false;Disable(false);calibrating=null;calibration.Clear();message=error??"音声入力を停止しました。口は通常入力へ戻ります。";}}
    public void Enable(FacialSnapshot target)
    {
        lock(gate){
            if(!input||!settings.Profile.Ready)throw new InvalidOperationException("音声入力を開始し、5つの母音を校正してください。");
            if(target.ModelSession==null||target.Presets is not {} catalog||!catalog.TryGetProperty("visemes",out var bank))throw new InvalidOperationException("母音を登録したモデルを読み込んでください。");
            var ids=bank.GetProperty("presets").EnumerateArray().Select(p=>p.GetProperty("id").GetString()).ToHashSet();
            if(!LipSyncProfile.VowelIds.Append("Silence").All(ids.Contains))throw new InvalidOperationException("モデルにA/I/U/E/O/Silenceの口形をすべて登録してください。");
            enabled=true;session=target.ModelSession;manualVersion=target.ManualVisemeVersion;release=false;initial=true;pending.Clear();message="音声から口形を適用中です。";
        }
    }
    private void Disable(bool preserveManual){if(enabled&&!preserveManual)release=true;enabled=false;initial=false;pending.Clear();}
    public void Disable(){lock(gate){Disable(false);message="口への適用を停止しました。音声の解析・校正は継続できます。";}}
    public void ModelStopped(string? modelSession){lock(gate){if(session!=modelSession)return;Disable(true);release=false;session=null;message="モデル描画を停止したため、音声の適用も停止しました。";}}
    public void ResetProfile(){lock(gate){Disable(false);settings=settings with{Profile=LipSyncProfile.Empty()};profileRevision++;calibrating=null;calibration.Clear();message="校正をリセットしました。";}}
    public void BeginCalibration(string id)
    {
        lock(gate){if(!input||!LipSyncProfile.VowelIds.Contains(id))throw new InvalidOperationException("音声入力を開始してください。");Disable(false);calibrating=id;calibration.Clear();calStart=now()+.4;calEnd=calStart+1.2;message=id+"を発声してください（約2秒）。";}
    }
    private void FinishCalibration(double time)
    {
        if(calibrating==null||time<calEnd)return;
        if(calibration.Count>=20){var vector=new double[12];foreach(var sample in calibration)for(int c=0;c<12;c++)vector[c]+=sample[c]/calibration.Count;var profile=settings.Profile.Copy();profile.Vowels[calibrating]=vector;settings=settings with{Profile=profile};profileRevision++;message=calibrating+"の校正を保存しました。";}
        else message="声のある区間が不足しています。音量・入力機器を確認して再校正してください。";
        calibrating=null;calibration.Clear();
    }
    public void Feed(AudioFeatures features)
    {
        if(!double.IsFinite(features.Rms)||features.Rms<0||features.Rms>16||features.Mfcc.Length!=12||features.Mfcc.Any(v=>!double.IsFinite(v)||Math.Abs(v)>10000))throw new ArgumentException("Invalid audio features");
        lock(gate){if(!input)return;double time=now();lastFrame=time;frames++;levelDb=20*Math.Log10(Math.Max(1e-6,features.Rms*settings.Gain));
            if(calibrating!=null&&time>=calStart&&time<calEnd&&levelDb>settings.GateDb&&calibration.Count<80)calibration.Add((double[])features.Mfcc.Clone());FinishCalibration(time);
            if(!settings.Profile.Ready){weights.Clear();vowel=null;return;}
            double amount=Math.Clamp((levelDb-settings.GateDb)/(settings.FullDb-settings.GateDb),0,1);
            var scores=amount>0?settings.Profile.Classify(features.Mfcc):LipSyncProfile.VowelIds.ToDictionary(id=>id,_=>0d);
            weights=scores.ToDictionary(p=>p.Key,p=>p.Value*amount);weights["Silence"]=1-amount;
            vowel=amount>0?scores.MaxBy(p=>p.Value).Key:"Silence";
            if(enabled){if(pending.Count>=128)pending.Dequeue();pending.Enqueue((time+settings.DelayMs/1000d,new(weights)));}
        }
    }
    public LipSyncStatus Snapshot(){lock(gate){double time=now();FinishCalibration(time);return new(input,enabled,frames,levelDb,vowel,new(weights),calibrating,Math.Max(0,calEnd-time),message,pending.Count,profileRevision,settings.Profile.Ready);}}
    // Call before draining manual facial commands on the renderer thread. Manual
    // vowels/clear suspend automatic output, so the next audio packet cannot win.
    public string? RenderCommand(FacialSnapshot target)
    {
        lock(gate){
            if(session!=null&&(session!=target.ModelSession||manualVersion!=target.ManualVisemeVersion)){
                Disable(true);release=false;session=null;message="モデル変更または手動の口形操作により、音声の適用を停止しました。";return null;
            }
            if(enabled&&now()-lastFrame>.5){Disable(false);message="音声入力が途切れたため、口を通常入力に戻しました。";}
            if(release){release=false;return target.ModelSession==session?"{\"action\":\"clear\",\"layer\":\"viseme\",\"immediate\":true}":null;}
            if(!enabled)return null;
            Dictionary<string,double>? latest=null;double time=now();while(pending.TryPeek(out var item)&&item.Due<=time){latest=pending.Dequeue().Weights;}
            if(latest==null&&!initial)return null;initial=false;latest??=new(){{"Silence",1}};
            return JsonSerializer.Serialize(new{action="visemes",weights=latest});
        }
    }
}
