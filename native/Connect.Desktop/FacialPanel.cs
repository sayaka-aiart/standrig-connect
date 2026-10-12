using System.Text.Json;
namespace StandRig.Connect.Desktop;

internal sealed partial class MainWindow
{
    private sealed record ExpressionChoice(string Id,string Name){public override string ToString()=>Name;}
    private Control CreateFacialControls()
    {
        var area=new FlowLayoutPanel{AutoSize=true,FlowDirection=FlowDirection.TopDown,WrapContents=false,MaximumSize=new Size(530,0)};
        area.Controls.Add(new Label{Text="StandRig本体で登録し、画像込みモデル（.srig）を書き出して読み込んでください。\n未登録の表情・母音は使用できません。音声からの適用は「リップシンク」へ。",AutoSize=true,MaximumSize=new Size(510,0)});
        var choices=new ComboBox{DropDownStyle=ComboBoxStyle.DropDownList,Width=280};
        var apply=new Button{Text="表情を適用",AutoSize=true};
        var clearExpression=new Button{Text="表情を解除",AutoSize=true};
        var row=new FlowLayoutPanel{AutoSize=true,WrapContents=true,MaximumSize=new Size(520,0)};row.Controls.AddRange(new Control[]{choices,apply,clearExpression});area.Controls.Add(row);
        var strength=new TrackBar{Minimum=0,Maximum=100,Value=100,TickFrequency=25,Width=300};
        var strengthLabel=new Label{Text="表情の強度: 100%",AutoSize=true,Margin=new Padding(3,14,3,0)};var strengthRow=new FlowLayoutPanel{AutoSize=true,WrapContents=false};strengthRow.Controls.AddRange(new Control[]{strengthLabel,strength});area.Controls.Add(strengthRow);
        void Send(object command){try{var session=Facial.Snapshot().ModelSession??throw new InvalidOperationException("先にモデル描画を開始してください");Facial.Submit(session,JsonSerializer.Serialize(command));}catch(Exception e){MessageBox.Show(this,e.Message,"表情・母音");}}
        void Select(){if(choices.SelectedItem is ExpressionChoice choice)Send(new{action="expression",id=choice.Id,strength=strength.Value/100d});}
        apply.Click+=(_,_)=>Select();
        // The slider previews the selected expression; selecting the list alone sends nothing.
        strength.ValueChanged+=(_,_)=>{strengthLabel.Text=$"表情の強度: {strength.Value}%";if(strength.Enabled)Select();};
        clearExpression.Click+=(_,_)=>Send(new{action="clear",layer="expression"});
        area.Controls.Add(new Label{Text="母音・口形を確認",AutoSize=true});
        var vowels=new FlowLayoutPanel{AutoSize=true,WrapContents=true,MaximumSize=new Size(520,0)};
        var vowelButtons=new Dictionary<string,Button>();
        foreach(var (id,label) in new[]{("A","あ"),("I","い"),("U","う"),("E","え"),("O","お"),("Silence","無音")}){
            var button=new Button{Text=label,Width=id=="Silence"?60:48,Height=26,Enabled=false};button.Click+=(_,_)=>Send(new{action="viseme",id});vowels.Controls.Add(button);vowelButtons[id]=button;
        }
        var clearViseme=new Button{Text="母音を解除",AutoSize=true};clearViseme.Click+=(_,_)=>Send(new{action="clear",layer="viseme"});vowels.Controls.Add(clearViseme);area.Controls.Add(vowels);
        var clearAll=new Button{Text="表情・母音をすべて解除",AutoSize=true};clearAll.Click+=(_,_)=>Send(new{action="clear",immediate=true});area.Controls.Add(clearAll);
        area.Controls.Add(new Label{Text="カメラ・モーションと併用できます。無音＝登録口形、解除＝現在の入力へ復帰。\n母音は表情より優先。数値APIの上書きは両方より優先します。",AutoSize=true,MaximumSize=new Size(510,0)});
        var status=new Label{AutoSize=false,Width=510,Height=52};area.Controls.Add(status);
        string? shownSession=null;
        refresh.Tick+=(_,_)=>{
            var snapshot=Facial.Snapshot();bool active=snapshot.ModelSession!=null&&Engine.Status.Running;
            if(snapshot.ModelSession!=shownSession){
                shownSession=snapshot.ModelSession;choices.Items.Clear();strength.Enabled=false;strength.Value=100;
                foreach(var button in vowelButtons.Values)button.Enabled=false;
                if(snapshot.Presets is {} catalog){
                    foreach(var e in catalog.GetProperty("expressions").EnumerateArray())choices.Items.Add(new ExpressionChoice(e.GetProperty("id").GetString()!,e.GetProperty("name").GetString()!));
                    if(catalog.TryGetProperty("visemes",out var bank))foreach(var p in bank.GetProperty("presets").EnumerateArray())vowelButtons[p.GetProperty("id").GetString()!].Enabled=true;
                }
                if(choices.Items.Count>0)choices.SelectedIndex=0;
            }
            row.Enabled=active;choices.Enabled=apply.Enabled=strength.Enabled=active&&choices.Items.Count>0;vowels.Enabled=clearAll.Enabled=clearExpression.Enabled=clearViseme.Enabled=active;
            string text="モデル描画を開始してください。";
            if(active){
                var expression=snapshot.State is {} state?state.GetProperty("expressionId").GetString():null;
                var weights=snapshot.State is {} s?s.GetProperty("visemeWeights").EnumerateObject().Where(p=>p.Value.GetDouble()>0).Select(p=>$"{p.Name}: {p.Value.GetDouble():F2}"):Array.Empty<string>();
                text=$"表情: {expression??"なし"} / 母音: {string.Join(", ",weights)}\n{(choices.Items.Count==0?"表情未登録。":"")}";
                if(snapshot.Error!=null)text+="\n"+snapshot.Error;
            }
            if(status.Text!=text)status.Text=text;
        };
        return area;
    }
}
