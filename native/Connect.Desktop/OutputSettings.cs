using System.Text.Json;
using StandRig.Connect;
namespace StandRig.Connect.Desktop;

internal sealed partial class MainWindow
{
    private OutputView outputView=new();
    private Form? outputSettings;
    private Label? framingLabel;
    private System.Windows.Forms.Timer? outputSaveTimer;
    private bool outputSettingsDirty;
    private static string OutputSettingsPath=>Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"StandRigConnect","output-settings.json");
    private Control CreateOutputSettingsButton()
    {
        if(!testing)try{if(File.Exists(OutputSettingsPath)){var saved=JsonSerializer.Deserialize<OutputView>(File.ReadAllText(OutputSettingsPath));saved?.Validate();if(saved!=null)outputView=saved;}}catch(Exception e) when(e is IOException or UnauthorizedAccessException or JsonException or ArgumentException){/* Invalid local settings fall back to defaults. */}
        var button=new Button{Text="解像度・構図…",AutoSize=true};
        var area=new FlowLayoutPanel{Dock=DockStyle.Fill,FlowDirection=FlowDirection.TopDown,WrapContents=false,Padding=new Padding(16),AutoScroll=true};
        var sizes=new (int W,int H)[]{(640,480),(1280,720),(1920,1080),(720,1280),(1080,1920),(1080,1080)};
        var choices=new ComboBox{DropDownStyle=ComboBoxStyle.DropDownList,Width=280};
        foreach(var (w,h) in sizes)choices.Items.Add($"{w} × {h}");
        int index=Array.FindIndex(sizes,s=>s.W==outputView.Width&&s.H==outputView.Height);
        if(index<0){sizes=sizes.Append((outputView.Width,outputView.Height)).ToArray();choices.Items.Add($"{outputView.Width} × {outputView.Height}");index=sizes.Length-1;}
        choices.SelectedIndex=index;
        choices.SelectedIndexChanged+=(_,_)=>{var (w,h)=sizes[choices.SelectedIndex];ChangeOutputView(Volatile.Read(ref outputView) with{Width=w,Height=h});};
        framingLabel=new Label{AutoSize=true,MaximumSize=new Size(360,0)};
        var reset=new Button{Text="全体を表示（位置・倍率をリセット）",AutoSize=true};
        reset.Click+=(_,_)=>ChangeOutputView(Volatile.Read(ref outputView) with{Zoom=1,X=0,Y=0});
        area.Controls.AddRange(new Control[]{new Label{Text="配信の出力解像度",AutoSize=true},choices,framingLabel,reset,new Label{Text="プレビュー上でホイール：拡大縮小\n左ドラッグ：移動\n構図はSpout2にも反映します。\nプレビューの窓サイズは送信解像度とは別です。",AutoSize=true,MaximumSize=new Size(360,0)}});
        outputSettings=new Form{Text="出力解像度・構図",ClientSize=new Size(410,265),FormBorderStyle=FormBorderStyle.FixedDialog,MaximizeBox=false,MinimizeBox=false,ShowInTaskbar=false,StartPosition=FormStartPosition.CenterParent};outputSettings.Controls.Add(area);
        outputSettings.FormClosing+=(_,e)=>{if(e.CloseReason==CloseReason.UserClosing){e.Cancel=true;outputSettings.Hide();FlushOutputSettings();}};
        button.Click+=(_,_)=>{UpdateFramingLabel();outputSettings.Show(this);outputSettings.Activate();};
        outputSaveTimer=new System.Windows.Forms.Timer{Interval=300};outputSaveTimer.Tick+=(_,_)=>FlushOutputSettings();UpdateFramingLabel();return button;
    }
    private void UpdateFramingLabel(){var view=Volatile.Read(ref outputView);if(framingLabel!=null)framingLabel.Text=$"倍率 {view.Zoom:P0} / 位置 {view.X:F2}, {view.Y:F2}";}
    private void ChangeOutputView(OutputView view)
    {
        view.Validate();var previous=Volatile.Read(ref outputView);Volatile.Write(ref outputView,view);
        if(previous.Width!=view.Width||previous.Height!=view.Height)FitOutputWindow();UpdateFramingLabel();
        if(!testing){outputSettingsDirty=true;outputSaveTimer?.Stop();outputSaveTimer?.Start();}
    }
    private void FitOutputWindow()
    {
        if(output==null)return;var view=Volatile.Read(ref outputView);var work=Screen.FromControl(output).WorkingArea;
        double scale=Math.Min(1,Math.Min(Math.Min(800,work.Width-100)/(double)view.Width,Math.Min(650,work.Height-100)/(double)view.Height));
        output.ClientSize=new Size(Math.Max(1,(int)Math.Round(view.Width*scale)),Math.Max(1,(int)Math.Round(view.Height*scale)));
    }
    private void ConfigureOutputGestures(Form window)
    {
        bool dragging=false;Point last=default;
        window.MouseWheel+=(_,e)=>{
            if(!window.Text.EndsWith("— Model",StringComparison.Ordinal))return;
            var view=Volatile.Read(ref outputView);
            ChangeOutputView(view.ZoomAt(Math.Pow(1.1,e.Delta/120d),e.X/(double)Math.Max(1,window.ClientSize.Width),e.Y/(double)Math.Max(1,window.ClientSize.Height)));
        };
        window.MouseDown+=(_,e)=>{if(e.Button==MouseButtons.Left&&window.Text.EndsWith("— Model",StringComparison.Ordinal)){dragging=true;last=e.Location;window.Capture=true;window.Cursor=Cursors.SizeAll;}};
        window.MouseMove+=(_,e)=>{if(!dragging)return;var view=Volatile.Read(ref outputView);ChangeOutputView(view.Pan((e.X-last.X)/(double)Math.Max(1,window.ClientSize.Width),(e.Y-last.Y)/(double)Math.Max(1,window.ClientSize.Height)));last=e.Location;};
        window.MouseUp+=(_,e)=>{if(e.Button==MouseButtons.Left){dragging=false;window.Capture=false;window.Cursor=Cursors.Default;}};
        window.MouseCaptureChanged+=(_,_)=>{dragging=false;window.Cursor=Cursors.Default;};
    }
    private void FlushOutputSettings()
    {
        outputSaveTimer?.Stop();if(!outputSettingsDirty||testing)return;
        string temporary=OutputSettingsPath+"."+Guid.NewGuid().ToString("N")+".tmp";
        try{Directory.CreateDirectory(Path.GetDirectoryName(OutputSettingsPath)!);File.WriteAllText(temporary,JsonSerializer.Serialize(Volatile.Read(ref outputView)));File.Move(temporary,OutputSettingsPath,true);outputSettingsDirty=false;}
        catch(Exception e) when(e is IOException or UnauthorizedAccessException){if(framingLabel!=null)framingLabel.Text="設定保存失敗: "+e.Message;}
        finally{try{if(File.Exists(temporary))File.Delete(temporary);}catch(IOException){}catch(UnauthorizedAccessException){}}
    }
}
