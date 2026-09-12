using StandRig.Connect.Evaluation;
namespace StandRig.Connect.Desktop;

internal sealed partial class MainWindow
{
    private string? loadedModelJson;
    private string? activeSlotId;
    private readonly Button saveSlotTracking=new(){Text="このスロットに調整を保存",AutoSize=true,Enabled=false};
    private readonly Label trackingSlotStatus=new(){Text="モデルをスロットに保存すると、ここから調整を保存できます。",AutoSize=true,MaximumSize=new Size(500,0)};
    private Func<TrackingControlsSnapshot>? captureTrackingControls;
    private Action<TrackingControlsSnapshot>? restoreTrackingControls;
    internal void VerifySlotControls(TrackingControlsSnapshot expected){
        var actual=captureTrackingControls!();if(actual.Smoothing!=expected.Smoothing||actual.EyeClosed!=expected.EyeClosed||actual.Enabled!=expected.Enabled||expected.Gains.Any(p=>!actual.Gains.TryGetValue(p.Key,out var value)||value!=p.Value))throw new InvalidOperationException("Slot sliders were not restored");
    }
    private Control CreateModelSlots()
    {
        var store=new ModelSlotStore(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"StandRigConnect","model-slots"));
        var area=new FlowLayoutPanel {AutoSize=true,FlowDirection=FlowDirection.TopDown,WrapContents=false};
        var list=new ComboBox {DropDownStyle=ComboBoxStyle.DropDownList,Width=440};
        var name=new TextBox {Width=440,MaxLength=80,PlaceholderText="スロット名"};
        var status=new Label {AutoSize=true,MaximumSize=new Size(520,0),Text="未保存"};
        var actions=new FlowLayoutPanel {AutoSize=true,WrapContents=true,MaximumSize=new Size(520,0)};
        var open=new Button {Text="スロットを使う",AutoSize=true};
        var create=new Button {Text="新しいスロットに保存",AutoSize=true};
        var update=new Button {Text="使用中のスロットを更新",AutoSize=true};
        actions.Controls.AddRange(new Control[]{open,create,update});
        area.Controls.AddRange(new Control[]{new Label {Text="モデルスロット",AutoSize=true,Font=new Font(Font,FontStyle.Bold)},list,name,actions,status});
        void Reload(string? id=null){var items=store.List();list.Items.Clear();list.Items.AddRange(items.Cast<object>().ToArray());list.SelectedIndex=id==null?-1:Array.FindIndex(items.ToArray(),s=>s.Id==id);}
        bool busySlots=false;
        list.SelectedIndexChanged+=(_,_)=>{if(list.SelectedItem is ModelSlotInfo info)name.Text=info.Name;};
        async Task Run(Func<Task> work){
            if(busySlots)return;busySlots=true;
            var previous=Controls.Cast<Control>().Select(c=>(Control:c,Enabled:c.Enabled)).ToArray();foreach(var item in previous)item.Control.Enabled=false;
            bool settingsEnabled=trackingSettings?.Enabled??false;if(trackingSettings!=null)trackingSettings.Enabled=false;
            try{await work();}catch(Exception ex){if(!IsDisposed)status.Text=trackingSlotStatus.Text="操作できませんでした: "+ex.Message;}
            finally{if(!IsDisposed){foreach(var item in previous)item.Control.Enabled=item.Enabled;if(trackingSettings!=null)trackingSettings.Enabled=settingsEnabled;}busySlots=false;}
        }
        async Task Save(bool replace){
            string model=Volatile.Read(ref loadedModelJson)??throw new InvalidOperationException("先にモデルを開いてください。");
            var tracking=Tracking;if(tracking==null||!Engine.Status.Running)throw new InvalidOperationException("モデル描画を開始してください。");
            string? id=replace?activeSlotId:null;if(replace&&(id==null||(list.SelectedItem as ModelSlotInfo)?.Id!=id))throw new InvalidOperationException("使用中のスロットがありません。");
            string title=name.Text;var controls=captureTrackingControls!();status.Text="モデルと調整を保存中…";
            string profile=await tracking.CaptureProfileAsync().WaitAsync(TimeSpan.FromSeconds(3));
            if(IsDisposed)return;
            var saved=await Task.Run(()=>store.Save(id,title,new(1,model,profile,controls)));
            if(IsDisposed)return;activeSlotId=saved.Id;store.RememberUsed(saved.Id);Reload(saved.Id);status.Text=$"保存済み: {saved.Name} / {saved.SavedAt.LocalDateTime:HH:mm:ss}";
        }
        saveSlotTracking.Click+=async(_,_)=>await Run(async()=>{
            string id=activeSlotId??throw new InvalidOperationException("先にモデルをスロットへ保存してください。");
            string model=Volatile.Read(ref loadedModelJson)??throw new InvalidOperationException("モデルを開いてください。");
            var tracking=Tracking??throw new InvalidOperationException("トラッキング設定がありません。");
            var controls=captureTrackingControls!();trackingSlotStatus.Text="調整を保存中…";
            string profile=await tracking.CaptureProfileAsync().WaitAsync(TimeSpan.FromSeconds(3));if(IsDisposed)return;
            var saved=await Task.Run(()=>store.SaveTracking(id,model,profile,controls));if(IsDisposed)return;
            Reload(saved.Id);status.Text=trackingSlotStatus.Text=$"調整を保存しました: {saved.Name} / {saved.SavedAt.LocalDateTime:HH:mm:ss}";
        });
        create.Click+=async(_,_)=>await Run(()=>Save(false));
        update.Click+=async(_,_)=>await Run(()=>Save(true));
        open.Click+=async(_,_)=>await Run(async()=>{
            if(list.SelectedItem is not ModelSlotInfo info)throw new InvalidOperationException("スロットを選択してください。");
            status.Text="スロットを読み込み中…";
            var doc=await Task.Run(()=>{
                var saved=store.Load(info.Id);
                using var evaluator=new ModelEvaluator();evaluator.Load(saved.ModelJson);evaluator.LoadTrackingProfile(saved.ProfileJson);return saved;
            });
            if(IsDisposed)return;
            StartModelRender("",modelJson:doc.ModelJson,initialTrackingProfile:doc.ProfileJson,controls:doc.Controls);
            var loadedTracking=Tracking;
            for(int attempt=0;attempt<100&&Engine.Status.Error==null&&(Volatile.Read(ref loadedModelJson)==null||loadedTracking?.State.Loaded!=true);attempt++){await Task.Delay(100);if(IsDisposed)return;}
            if(Engine.Status.Error!=null||Volatile.Read(ref loadedModelJson)==null||loadedTracking?.State.Loaded!=true)throw new InvalidOperationException(Engine.Status.Error??loadedTracking?.State.Error??"モデルの読込が完了しませんでした。");
            activeSlotId=info.Id;store.RememberUsed(info.Id);status.Text="使用中: "+info.Name;
        });
        string? displayedTarget=null;
        refresh.Tick+=(_,_)=>{
            bool ready=Volatile.Read(ref loadedModelJson)!=null&&Tracking?.State.Loaded==true&&Engine.Status.Running;
            saveSlotTracking.Enabled=!busySlots&&ready&&activeSlotId!=null;
            if(displayedTarget!=activeSlotId){displayedTarget=activeSlotId;trackingSlotStatus.Text=activeSlotId==null?"先にモデルをスロットへ保存してください。":"保存先: "+list.Items.Cast<ModelSlotInfo>().FirstOrDefault(s=>s.Id==activeSlotId)?.Name;}
            create.Enabled=!busySlots&&ready;update.Enabled=!busySlots&&ready&&activeSlotId!=null&&(list.SelectedItem as ModelSlotInfo)?.Id==activeSlotId;open.Enabled=!busySlots&&list.SelectedItem!=null;
        };
        if(!testing){try{Reload(store.LastUsed());status.Text=list.Items.Count==0?"保存済みスロットはありません。":list.SelectedItem!=null?"前回のスロットを選択しています。「スロットを使う」で開始できます。":"スロットを選んで読み込めます。";}catch(Exception ex){status.Text="スロット一覧取得失敗: "+ex.Message;}}
        return area;
    }
}
