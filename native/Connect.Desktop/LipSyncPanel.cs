using StandRig.Connect.Audio;
namespace StandRig.Connect.Desktop;

internal sealed partial class MainWindow
{
    internal readonly LipSyncControl LipSync=new();
    private AudioInput? audioInput;
    private Form? lipSyncSettingsWindow;
    private Control CreateLipSyncControls()
    {
        audioInput=new(LipSync);
        string settingsPath=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"StandRigConnect","lipsync-settings.json");
        string? settingsError=null;bool canSave=true;
        if(!testing)try{LipSync.Configure(LipSyncSettings.Load(settingsPath));}catch(Exception e){settingsError="設定読込エラー: "+e.Message;try{if(File.Exists(settingsPath))File.Copy(settingsPath,settingsPath+".invalid-"+Guid.NewGuid().ToString("N")+".bak");}catch(Exception backupError){canSave=false;settingsError+=" / 元の設定を保護して保存を停止: "+backupError.Message;}}
        long savedRevision=LipSync.Snapshot().ProfileRevision;
        var area=new FlowLayoutPanel{AutoSize=true,FlowDirection=FlowDirection.TopDown,WrapContents=false,MaximumSize=new Size(530,0)};
        area.Controls.Add(new Label{Text="マイクやDAWからの録音入力で、登録済みの口形を動かします。\n起動時は入力OFF。音声の保存・再生・OBSへの音声送信は行いません。",AutoSize=true,MaximumSize=new Size(510,0)});
        var devices=new ComboBox{DropDownStyle=ComboBoxStyle.DropDownList,Width=350};var refreshDevices=new Button{Text="一覧を更新",AutoSize=true};
        var deviceRow=new FlowLayoutPanel{AutoSize=true,WrapContents=false};deviceRow.Controls.AddRange(new Control[]{devices,refreshDevices});area.Controls.Add(deviceRow);
        var start=new Button{Text="音声入力を開始",AutoSize=true};var stopAudio=new Button{Text="音声入力を停止",AutoSize=true};var applyAudio=new CheckBox{Text="音声で口を動かす",AutoSize=true,Margin=new Padding(6,7,0,0)};
        var inputRow=new FlowLayoutPanel{AutoSize=true,WrapContents=false};inputRow.Controls.AddRange(new Control[]{start,stopAudio,applyAudio});area.Controls.Add(inputRow);
        var status=new Label{Width=510,Height=72,AutoSize=false};
        area.Controls.Add(new Label{Text="自分の声を校正：ボタンを押し、その母音を約2秒発声します。",AutoSize=true});
        var calibrationRow=new FlowLayoutPanel{AutoSize=true,WrapContents=false};var calibrationButtons=new Dictionary<string,Button>();
        foreach(var (id,label) in new[]{("A","あ"),("I","い"),("U","う"),("E","え"),("O","お")}){
            var button=new Button{Text=label,Width=64,Height=27};button.Click+=(_,_)=>LipSync.BeginCalibration(id);calibrationButtons[id]=button;calibrationRow.Controls.Add(button);
        }
        area.Controls.Add(calibrationRow);
        var adjust=new Button{Text="音量・遅延を調整…",AutoSize=true};var reset=new Button{Text="校正をリセット",AutoSize=true};
        var settingsRow=new FlowLayoutPanel{AutoSize=true};settingsRow.Controls.AddRange(new Control[]{adjust,reset});area.Controls.Add(settingsRow);
        area.Controls.Add(new Label{Text="モデルにA/I/U/E/O/無音を登録し、声を5種類校正してから適用します。\n手動の母音選択やAPI操作、モデル切替では音声の適用がOFFになります。",AutoSize=true,MaximumSize=new Size(510,0)});area.Controls.Add(status);
        bool syncing=false,enumerating=false;
        void SetSettings(Func<LipSyncSettings,LipSyncSettings> change){LipSync.Configure(change(LipSync.Settings()));}
        async Task RefreshDevices(){
            if(enumerating)return;enumerating=true;refreshDevices.Enabled=false;
            try{var list=await Task.Run(AudioInput.Devices);if(IsDisposed)return;string? selected=(devices.SelectedItem as AudioDevice)?.Id??LipSync.Settings().DeviceId;devices.Items.Clear();devices.Items.AddRange(list);devices.SelectedIndex=Array.FindIndex(list,d=>d.Id==selected);if(devices.SelectedIndex<0&&list.Length>0)devices.SelectedIndex=0;if(list.Length==0)settingsError="録音デバイスがありません。Windowsの音声設定を確認してください。";}
            catch(Exception e){settingsError="音声デバイス一覧エラー: "+e.Message;}finally{enumerating=false;if(!IsDisposed)refreshDevices.Enabled=!audioInput.Running;}
        }
        refreshDevices.Click+=async(_,_)=>await RefreshDevices();
        devices.SelectedIndexChanged+=(_,_)=>{if(devices.SelectedItem is AudioDevice selected)SetSettings(s=>s with{DeviceId=selected.Id});};
        start.Click+=async(_,_)=>{start.Enabled=false;try{if(devices.SelectedItem is not AudioDevice selected)throw new InvalidOperationException("録音デバイスを選択してください。");await audioInput.StopAsync();if(IsDisposed)return;audioInput.Start(selected.Id);settingsError=null;}catch(Exception e){settingsError=e.Message;}finally{if(!IsDisposed)start.Enabled=true;}};
        stopAudio.Click+=async(_,_)=>{stopAudio.Enabled=false;try{await audioInput.StopAsync();}catch(Exception e){settingsError="停止エラー: "+e.Message;}finally{if(!IsDisposed)stopAudio.Enabled=true;}};
        applyAudio.CheckedChanged+=(_,_)=>{if(syncing)return;try{if(applyAudio.Checked)LipSync.Enable(Facial.Snapshot());else LipSync.Disable();}catch(Exception e){settingsError=e.Message;syncing=true;applyAudio.Checked=false;syncing=false;}};
        reset.Click+=(_,_)=>LipSync.ResetProfile();
        adjust.Click+=(_,_)=>{
            if(lipSyncSettingsWindow!=null){lipSyncSettingsWindow.Show();lipSyncSettingsWindow.Activate();return;}
            var settings=LipSync.Settings();var content=new FlowLayoutPanel{Dock=DockStyle.Fill,AutoSize=true,FlowDirection=FlowDirection.TopDown,WrapContents=false,Padding=new Padding(12)};
            void Slider(string name,int min,int max,int value,Func<int,string> label,Action<int> change){
                var row=new FlowLayoutPanel{AutoSize=true,WrapContents=false};var text=new Label{Text=name+": "+label(value),Width=175,Height=35,Margin=new Padding(3,12,0,0)};var slider=new TrackBar{Minimum=min,Maximum=max,Value=Math.Clamp(value,min,max),TickStyle=TickStyle.None,Width=285};
                slider.ValueChanged+=(_,_)=>{text.Text=name+": "+label(slider.Value);change(slider.Value);};row.Controls.AddRange(new Control[]{text,slider});content.Controls.Add(row);
            }
            Slider("入力の強さ",1,80,(int)Math.Round(settings.Gain*10),v=>$"{v/10d:F1}倍",v=>SetSettings(s=>s with{Gain=v/10d}));
            Slider("無音判定",-80,-35,(int)settings.GateDb,v=>$"{v} dB",v=>SetSettings(s=>s with{GateDb=v}));
            Slider("最大開口の音量",-30,-5,(int)settings.FullDb,v=>$"{v} dB",v=>SetSettings(s=>s with{FullDb=v}));
            Slider("口の反映を遅らせる",0,2000,settings.DelayMs,v=>$"{v} ms",v=>SetSettings(s=>s with{DelayMs=v}));
            content.Controls.Add(new Label{Text="遅延は口形だけに加算します。配信用音声は変更しません。\n口が先に動く場合はここで遅らせます。口が遅い場合は\nOBS側の音声同期オフセットで音声を遅らせて調整します。\n校正・設定はアプリ共通で自動保存。入力・適用は起動時OFFです。",AutoSize=true,MaximumSize=new Size(470,0)});
            lipSyncSettingsWindow=new Form{Text="リップシンク：音量・遅延",ClientSize=new Size(510,360),FormBorderStyle=FormBorderStyle.FixedDialog,MaximizeBox=false,MinimizeBox=false,ShowInTaskbar=false,StartPosition=FormStartPosition.CenterParent};lipSyncSettingsWindow.Controls.Add(content);
            lipSyncSettingsWindow.FormClosed+=(_,_)=>lipSyncSettingsWindow=null;lipSyncSettingsWindow.Show(this);
        };
        refresh.Tick+=(_,_)=>{
            var current=LipSync.Snapshot();var settings=LipSync.Settings();bool running=audioInput.Running;
            start.Enabled=!running&&devices.SelectedItem!=null;stopAudio.Enabled=running;devices.Enabled=!running;refreshDevices.Enabled=!running&&!enumerating;
            foreach(var (id,button) in calibrationButtons){button.Enabled=current.InputRunning&&current.Calibrating==null;string label=id switch{"A"=>"あ","I"=>"い","U"=>"う","E"=>"え",_=>"お"};button.Text=label+(settings.Profile.Vowels.ContainsKey(id)?" ✓":"");}
            applyAudio.Enabled=current.InputRunning&&current.Ready&&Engine.Status.Running;syncing=true;applyAudio.Checked=current.Enabled;syncing=false;
            if(!testing&&canSave&&savedRevision!=current.ProfileRevision){savedRevision=current.ProfileRevision;try{settings.Save(settingsPath);}catch(Exception e){settingsError="設定保存エラー: "+e.Message;}}
            string text=$"音量: {current.LevelDb:F1} dB / 推定: {current.Vowel??"校正待ち"} / 適用: {(current.Enabled?"ON":"OFF")}\n{current.Message}";
            if(current.Calibrating!=null)text+=$" 残り{current.CalibrationRemaining:F1}秒";if(settingsError!=null)text+="\n"+settingsError;if(status.Text!=text)status.Text=text;
        };
        if(!testing)Shown+=async(_,_)=>await RefreshDevices();
        return area;
    }
}
