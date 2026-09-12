using System.Text.Json;
using System.Diagnostics;
using StandRig.Connect.Evaluation;
if(args.Length>0&&args[0]=="--pitch-profile"){
 var old="""{"name":"Connect standard","tracking":{"mappings":[{"source":"facePitch","parameter":"ParamAngleY","scale":22.5},{"source":"bodyPitch","parameter":"ParamBodyAngleY","scale":8}]}}""";
 string upgraded=DefaultTracking.UpgradeProfile(old);
 using var doc=JsonDocument.Parse(upgraded);var maps=doc.RootElement.GetProperty("tracking").GetProperty("mappings");
 if(maps[0].GetProperty("scale").GetDouble()!=45||maps[1].GetProperty("scale").GetDouble()!=20)throw new Exception("Pitch upgrade lost gain");
 if(DefaultTracking.UpgradeProfile(upgraded)!=upgraded)throw new Exception("Pitch upgrade applied twice");
 string custom=old.Replace("Connect standard","Custom");if(DefaultTracking.UpgradeProfile(custom)!=custom)throw new Exception("Custom profile changed");

 var v2=old.Replace("Connect standard","Connect standard v2").Replace("22.5","45").Replace("\"scale\":8","\"scale\":20").Replace("\"scale\":45","\"scale\":45,\"invert\":true");
 using var v3=JsonDocument.Parse(DefaultTracking.UpgradeProfile(v2));
 var face=v3.RootElement.GetProperty("tracking").GetProperty("mappings")[0];
 if(face.GetProperty("invert").GetBoolean()||face.GetProperty("scale").GetDouble()!=45)throw new Exception("Direction upgrade changed gain or failed to flip");
 if(DefaultTracking.Mappings.Single(m=>m.Source=="facePitch").Invert||DefaultTracking.Mappings.Single(m=>m.Source=="bodyPitch").Invert)throw new Exception("Pitch default sign changed");
 Console.WriteLine("PASS pitch profile gains, direction, idempotence and custom preservation");return;
}
if(args.Length>0&&args[0]=="--model-slots"){
 var slotDirectory=Path.Combine("reports","slot-tests-"+Guid.NewGuid().ToString("N"));var store=new ModelSlotStore(slotDirectory);
 using var slotEvaluator=new ModelEvaluator();string source=File.ReadAllText("reports/evaluation/model.json");using var metadata=JsonDocument.Parse(slotEvaluator.Load(source));
 var tracking=new TrackingPlayback(()=>1);tracking.LoadProfile(DefaultTracking.Create(metadata.RootElement.GetProperty("parameters")));tracking.SetEnabled(true);tracking.Advance(slotEvaluator);
 tracking.Submit(1,new Dictionary<string,double>{{"facePitch",.2}});tracking.Advance(slotEvaluator);tracking.CalibrateNeutral();tracking.Advance(slotEvaluator);
 tracking.Adjust("facePitch",2,true,.25,.5);
 var pending=tracking.CaptureProfileAsync();if(pending.IsCompleted)throw new Exception("Snapshot skipped pending adjustment");tracking.Advance(slotEvaluator);string profile=await pending;
 using(var applied=JsonDocument.Parse(profile)){var face=applied.RootElement.GetProperty("tracking").GetProperty("mappings").EnumerateArray().Single(m=>m.GetProperty("source").GetString()=="facePitch");if(face.GetProperty("scale").GetDouble()!=60)throw new Exception("Stale saved gain");}
 var controls=new TrackingControlsSnapshot(new(){{"facePitch",new(2,true)}},.25,.5,true);
 var payload=new ModelSlotDocument(1,source,profile,controls);var first=store.Save(null,"テストモデル",payload);
 var reloadedStore=new ModelSlotStore(slotDirectory);var restored=reloadedStore.Load(first.Id);
 if(restored.ModelJson!=source||restored.ProfileJson!=profile||restored.Controls.Gains["facePitch"]!=controls.Gains["facePitch"])throw new Exception("Slot roundtrip failed");
 using(var freshSlotEvaluator=new ModelEvaluator()){freshSlotEvaluator.Load(restored.ModelJson);freshSlotEvaluator.LoadTrackingProfile(restored.ProfileJson);using var mapped=JsonDocument.Parse(freshSlotEvaluator.MapTracking("{\"timestampMs\":0,\"inputs\":{\"facePitch\":0.2}}"));if(Math.Abs(mapped.RootElement.GetProperty("ParamAngleY").GetDouble())>1e-8)throw new Exception("Slot lost calibration");}
 var updated=store.Save(first.Id,"更新名",payload);if(store.List().Count!=1||updated.Revision==first.Revision||store.List()[0].Name!="更新名")throw new Exception("Update duplicated slot");
 try{store.Save(first.Id,"bad",payload with{ModelJson="{}"});throw new Exception("Invalid model accepted");}catch(InvalidDataException){}
 if(store.List()[0].Revision!=updated.Revision||store.Load(first.Id).ModelJson!=source)throw new Exception("Failed update damaged saved slot");
 try{store.Load("../escape");throw new Exception("Path traversal accepted");}catch(ArgumentException){}
 string payloadPath=Path.Combine(slotDirectory,first.Id,updated.Revision+".json");byte[] before=File.ReadAllBytes(payloadPath);
 var changedControls=controls with {Smoothing=.4,EyeClosed=.55};
 string changedProfile=DefaultTracking.Adjust(profile,changedControls.Gains.ToDictionary(p=>p.Key,p=>(p.Value.Gain,p.Value.Invert)),.4,.55);
 var trackingSave=store.SaveTracking(first.Id,source,changedProfile,changedControls);
 if(trackingSave.Revision!=updated.Revision||trackingSave.Name!="更新名"||!before.SequenceEqual(File.ReadAllBytes(payloadPath)))throw new Exception("Tracking save rewrote model");
 var trackingRestored=new ModelSlotStore(slotDirectory).Load(first.Id);
 if(trackingRestored.ModelJson!=source||trackingRestored.ProfileJson!=changedProfile||trackingRestored.Controls.Smoothing!=.4)throw new Exception("Tracking-only save failed to restore");
 try{store.SaveTracking(first.Id,source+" ",changedProfile,changedControls);throw new Exception("Wrong model accepted");}catch(InvalidOperationException){}
 if(store.List()[0].TrackingRevision!=trackingSave.TrackingRevision)throw new Exception("Failed tracking update changed pointer");
 store.Save(first.Id,"full",payload);if(store.Load(first.Id).ProfileJson!=profile||store.List()[0].TrackingRevision!=null)throw new Exception("Full save retained stale tracking overlay");
 if(store.LastUsed()!=null)throw new Exception("Unexpected previous slot");
 store.RememberUsed(first.Id);if(new ModelSlotStore(slotDirectory).LastUsed()!=first.Id)throw new Exception("Last used did not survive restart");
 var second=store.Save(null,"second",payload);if(store.LastUsed()!=first.Id)throw new Exception("Creating storage changed last-used without activation");
 store.RememberUsed(second.Id);if(store.LastUsed()!=second.Id)throw new Exception("Last-used switch failed");
 File.WriteAllText(Path.Combine(slotDirectory,"last-used.json"),"broken");if(store.LastUsed()!=null)throw new Exception("Corrupt preference did not fall back");
 File.WriteAllText(Path.Combine(slotDirectory,"last-used.json"),JsonSerializer.Serialize(Guid.NewGuid().ToString("N")));if(store.LastUsed()!=null)throw new Exception("Missing slot selected");
 Console.WriteLine("PASS slot persistence, tracking-only save, last-used restart/switch and missing/corrupt preference fallback");return;
}
if(args.Length>0&&args[0]=="--eye-tracking"){
 using var e=new ModelEvaluator();using var eyeMeta=JsonDocument.Parse(e.Load(File.ReadAllText("reports/native-production-source.json")));
 string profile=DefaultTracking.Create(eyeMeta.RootElement.GetProperty("parameters"));e.LoadTrackingProfile(profile);
 Dictionary<string,double> Map(double time,double left,double right)=>JsonSerializer.Deserialize<Dictionary<string,double>>(e.MapTracking(JsonSerializer.Serialize(new{timestampMs=time,inputs=new {eyeLOpen=left,eyeROpen=right,eyeBallX=.5}})))!;
 var closed=Map(0,.55,1);if(closed["ParamEyeROpen"]!=0||closed["ParamEyeLOpen"]!=1)throw new Exception("Blink did not fully close independently");
 var other=Map(1,1,.55);if(other["ParamEyeROpen"]!=1||other["ParamEyeLOpen"]!=0)throw new Exception("Blink retained smoothing tail: "+JsonSerializer.Serialize(other));
 if(other["ParamEyeBallX"]<=0)throw new Exception("Gaze direction not reversed");
 var gains=new Dictionary<string,(double Gain,bool Invert)>{{"eyeLOpen",(1,false)},{"eyeROpen",(1,false)}};
 e.LoadTrackingProfile(DefaultTracking.Adjust(profile,gains,.95,.4),true);
 var adjusted=Map(2,.35,.35);if(adjusted["ParamEyeLOpen"]!=0||adjusted["ParamEyeROpen"]!=0)throw new Exception("Closure slider not applied");
 var open=Map(3,1,1);if(open["ParamEyeLOpen"]!=1||open["ParamEyeROpen"]!=1)throw new Exception("Open range lost");
 var directions=new Dictionary<string,(double Gain,bool Invert)>{{"faceYaw",(1,false)},{"bodyYaw",(1,false)},{"eyeBallX",(1,false)}};
 using(var defaults=JsonDocument.Parse(DefaultTracking.Adjust(profile,directions,0)))foreach(var mapping in defaults.RootElement.GetProperty("tracking").GetProperty("mappings").EnumerateArray()){
   string source=mapping.GetProperty("source").GetString()!;if(directions.ContainsKey(source)&&mapping.GetProperty("invert").GetBoolean()!=DefaultTracking.Mappings.Single(m=>m.Source==source).Invert)throw new Exception("Unchecked inversion changed standard direction");
 }
 foreach(var source in directions.Keys.ToArray())directions[source]=(1,true);
 using(var reversed=JsonDocument.Parse(DefaultTracking.Adjust(profile,directions,0)))foreach(var mapping in reversed.RootElement.GetProperty("tracking").GetProperty("mappings").EnumerateArray()){
   string source=mapping.GetProperty("source").GetString()!;if(directions.ContainsKey(source)&&mapping.GetProperty("invert").GetBoolean()==DefaultTracking.Mappings.Single(m=>m.Source==source).Invert)throw new Exception("Checked inversion did not reverse standard direction");
 }
 Console.WriteLine("PASS eye closure/reopen, threshold, gaze and relative mirror inversion");return;
}
if(args.Length>0&&args[0]=="--tracking-adjust-continuity"){
 using var e=new ModelEvaluator();using var metadata=JsonDocument.Parse(e.Load(File.ReadAllText("reports/native-production-source.json")));
 double testClock=1;var playback=new TrackingPlayback(()=>testClock);playback.LoadProfile(DefaultTracking.Create(metadata.RootElement.GetProperty("parameters")));playback.SetEnabled(true);playback.Advance(e);
 playback.Submit(1,new Dictionary<string,double>{{"mouthOpen",.8}});var first=playback.Advance(e)!["ParamMouthOpen"];
 playback.Adjust("mouthOpen",2,false,.15);
 var held=playback.Advance(e);
 if(held==null||held["ParamMouthOpen"]!=first||!playback.State.Active)throw new Exception("Slider dropped active mouth between camera frames");
 for(int i=2;i<10;i++){
   playback.Adjust("mouthOpen",1,false,.95);playback.Advance(e);
   playback.Submit(i,new Dictionary<string,double>{{"mouthOpen",.8}});
   if(playback.Advance(e)!["ParamMouthOpen"]<first)throw new Exception("Slider reset smoothing towards closed mouth");
 }
 testClock+=.6;playback.Adjust("mouthOpen",1,false,.15);if(playback.Advance(e)!=null||playback.State.Active)throw new Exception("Adjustment revived stale face");
 foreach(var source in new[]{"faceYaw","bodyYaw"})if(!DefaultTracking.Mappings.Single(m=>m.Source==source).Invert)throw new Exception("Mirror default missing");
 Console.WriteLine("PASS slider continuity, smoothing, face timeout and mirror defaults");return;
}
if(args.Length>0&&args[0]=="--default-tracking"){
 using var e=new ModelEvaluator();using var defaultMeta=JsonDocument.Parse(e.Load(File.ReadAllText("reports/evaluation/model.json")));
 string profile=DefaultTracking.Create(defaultMeta.RootElement.GetProperty("parameters"));
 e.LoadTrackingProfile(profile);
 var ids=defaultMeta.RootElement.GetProperty("parameters").EnumerateArray().Select(p=>p.GetProperty("id").GetString()).ToHashSet();
 using(var doc=JsonDocument.Parse(profile))foreach(var m in doc.RootElement.GetProperty("tracking").GetProperty("mappings").EnumerateArray())if(!ids.Contains(m.GetProperty("parameter").GetString()))throw new Exception("Unknown target");
 double clock=1;var playback=new TrackingPlayback(()=>clock);playback.LoadProfile(profile);playback.SetEnabled(true);playback.Advance(e);
 playback.Submit(1,new Dictionary<string,double>{{"facePitch",.2}});playback.Advance(e);playback.CalibrateNeutral();playback.Advance(e);
 playback.Adjust("facePitch",2,true,0);playback.Advance(e);
 playback.Submit(2,new Dictionary<string,double>{{"facePitch",.2}});if(Math.Abs(playback.Advance(e)!["ParamAngleY"])>1e-8)throw new Exception("Adjustment lost calibration");
 playback.Submit(3,new Dictionary<string,double>{{"facePitch",.3}});if(Math.Abs(playback.Advance(e)!["ParamAngleY"]-3)>1e-8)throw new Exception("Gain/invert adjustment failed");
 playback.Adjust("facePitch",2,true,0);playback.Advance(e);playback.Submit(4,new Dictionary<string,double>{{"facePitch",.3}});if(Math.Abs(playback.Advance(e)!["ParamAngleY"]-3)>1e-8)throw new Exception("Gain compounded");
 using var empty=JsonDocument.Parse("[]");using var emptyProfile=JsonDocument.Parse(DefaultTracking.Create(empty.RootElement));if(emptyProfile.RootElement.GetProperty("tracking").GetProperty("mappings").GetArrayLength()!=0)throw new Exception("Missing parameters mapped");
 Console.WriteLine("PASS default targets, calibration preserved, absolute gain, inversion, missing parameters");return;
}
if(args.Length>0&&args[0]=="--face-input"){
 using var e=new ModelEvaluator();
 double[] matrix={1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1};
 string Observation(double[] m,double jaw=.6)=>JsonSerializer.Serialize(new{Count=1,Blendshapes=new Dictionary<string,double>{{"jawOpen",jaw},{"eyeBlinkLeft",.25},{"eyeBlinkRight",.75}},MatrixRowMajor=m});
 Dictionary<string,double> Convert(double[] m)=>JsonSerializer.Deserialize<Dictionary<string,double>>(e.ConvertFace(Observation(m)))!;
 void Near(double actual,double expected){if(Math.Abs(actual-expected)>1e-9)throw new Exception($"Face conversion {actual} != {expected}");}
 var neutral=Convert(matrix);if(neutral.Count!=15)throw new Exception("Missing face channels");
 Near(neutral["faceYaw"],0);Near(neutral["facePitch"],0);Near(neutral["faceRoll"],0);Near(neutral["mouthOpen"],.6);Near(neutral["eyeLOpen"],.75);Near(neutral["eyeROpen"],.25);
 double angle=.225;matrix[5]=Math.Cos(angle);matrix[6]=-Math.Sin(angle);matrix[9]=Math.Sin(angle);matrix[10]=Math.Cos(angle);
 var tilted=Convert(matrix);Near(tilted["facePitch"],.5);Near(tilted["bodyPitch"],.225);
 if(e.ConvertFace("{\"Count\":0}")!="null")throw new Exception("No face synthesized input");
 foreach(string bad in new[]{"{}",Observation(new double[15]),Observation(matrix,2),Observation(matrix).Replace("\"Count\":1","\"Count\":2"),Observation(matrix).Replace("\"Count\":1","\"extra\":true,\"Count\":1")}){
  bool rejected=false;try{e.ConvertFace(bad);}catch(Microsoft.ClearScript.ScriptEngineException){rejected=true;}if(!rejected)throw new Exception("Invalid face accepted");
 }
 e.Load(File.ReadAllText("reports/evaluation/model.json"));
 e.LoadTrackingProfile(JsonSerializer.Serialize(new{format="standrig-tracking-profile",version=1,name="face-conversion-test",tracking=new{enabled=true,provider="manual",inputSmoothing=0,mappings=new[]{new{id="face",enabled=true,source="facePitch",parameter="ParamAngleY",scale=10,offset=0,smoothing=0,filter="ema",invert=false}}}}));
 using var mapped=JsonDocument.Parse(e.MapTracking(JsonSerializer.Serialize(new{timestampMs=0,inputs=tilted})));Near(mapped.RootElement.GetProperty("ParamAngleY").GetDouble(),5);
 Console.WriteLine("PASS face matrix direction, independent body gain, expressions, no-face, invalid boundaries and model mapping");return;
}
if(args.Length>0&&args[0]=="--tracking"){
 using var e=new ModelEvaluator();string model=File.ReadAllText("reports/evaluation/model.json");e.Load(model);
 string profile=JsonSerializer.Serialize(new{format="standrig-tracking-profile",version=1,name="native-test",tracking=new{enabled=true,provider="manual",inputSmoothing=0,mappings=new[]{new{id="face",enabled=true,source="facePitch",parameter="ParamAngleY",scale=10,offset=0,smoothing=0,filter="ema",invert=true},new{id="body",enabled=true,source="bodyPitch",parameter="ParamBodyAngleY",scale=20,offset=0,smoothing=0,filter="ema",invert=false}}}});
 e.LoadTrackingProfile(profile);
 using(var result=JsonDocument.Parse(e.MapTracking("{\"timestampMs\":10,\"inputs\":{\"facePitch\":0.5,\"bodyPitch\":0.25}}"))){if(result.RootElement.GetProperty("ParamAngleY").GetDouble()!=-5||result.RootElement.GetProperty("ParamBodyAngleY").GetDouble()!=5)throw new Exception("Face/body axes coupled");}
 void RejectTracking(Action action){try{action();}catch(Microsoft.ClearScript.ScriptEngineException){return;}throw new Exception("Invalid tracking accepted");}
 RejectTracking(()=>e.MapTracking("{\"timestampMs\":9,\"inputs\":{}}"));
 RejectTracking(()=>e.MapTracking("{\"timestampMs\":100,\"inputs\":{\"facePitch\":2}}"));
 RejectTracking(()=>e.LoadTrackingProfile("{}"));
 using(var result=JsonDocument.Parse(e.MapTracking("{\"timestampMs\":11,\"inputs\":{\"bodyPitch\":0.5}}"))){if(result.RootElement.EnumerateObject().Count()!=1||result.RootElement.GetProperty("ParamBodyAngleY").GetDouble()!=10)throw new Exception("Partial tracking mismatch: "+result.RootElement.GetRawText());}
 e.ResetTracking();e.MapTracking("{\"timestampMs\":0,\"inputs\":{}}");
 double clock=10;var playback=new TrackingPlayback(()=>clock);playback.LoadProfile(profile);playback.SetEnabled(true);
 var sample=new Dictionary<string,double>{{"facePitch",.5}};playback.Submit(1,sample);sample["facePitch"]=-1;
 if(playback.Advance(e)!["ParamAngleY"]!=-5)throw new Exception("Tracking sample was not copied");
 playback.Submit(2,new Dictionary<string,double>{{"bodyPitch",.1}});playback.Submit(3,new Dictionary<string,double>{{"bodyPitch",.25}});
 if(playback.Submit(2,sample)||playback.Advance(e)!["ParamBodyAngleY"]!=5||playback.State.Sequence!=3)throw new Exception("Tracking latest-only sequence mismatch");
 clock+=.5;if(playback.Advance(e)!=null||playback.State.Active)throw new Exception("Stale tracking overlay retained");
 playback.Submit(4,new Dictionary<string,double>{{"facePitch",.2}});if(playback.Advance(e)!["ParamAngleY"]!=-2)throw new Exception("Tracking did not recover");
 playback.SetEnabled(false);if(playback.Advance(e)!=null||playback.Submit(5,sample))throw new Exception("Disabled tracking accepted input");
 playback.SetEnabled(true);playback.Submit(6,new Dictionary<string,double>{{"facePitch",.2}});playback.Advance(e);
 playback.CalibrateNeutral();if(playback.Advance(e)!=null||playback.State.Error!=null)throw new Exception("Calibration failed");
 string calibratedProfile=playback.State.ProfileJson??throw new Exception("Missing applied profile snapshot");
 using(var restored=new ModelEvaluator()){
  restored.Load(model);restored.LoadTrackingProfile(calibratedProfile);
  using var result=JsonDocument.Parse(restored.MapTracking("{\"timestampMs\":0,\"inputs\":{\"facePitch\":0.2}}"));
  if(Math.Abs(result.RootElement.GetProperty("ParamAngleY").GetDouble())>1e-9)throw new Exception("Exported calibration did not roundtrip");
 }
 playback.LoadProfile("{}");playback.Advance(e);
 if(playback.State.ProfileJson!=calibratedProfile)throw new Exception("Rejected profile replaced export snapshot");
 if(new TrackingPlayback().State.ProfileJson!=null)throw new Exception("New model inherited profile snapshot");
 playback.Submit(7,new Dictionary<string,double>{{"facePitch",.2}});if(Math.Abs(playback.Advance(e)!["ParamAngleY"])>1e-9)throw new Exception("Neutral not centered");
 clock+=.5;playback.CalibrateNeutral();playback.Advance(e);if(playback.State.Error==null)throw new Exception("Stale calibration accepted");
 playback.ClearCalibration();playback.Advance(e);if(playback.State.Error!=null)throw new Exception("Clear calibration failed");
 playback.Submit(8,new Dictionary<string,double>{{"facePitch",.2}});if(playback.Advance(e)!["ParamAngleY"]!=-2)throw new Exception("Calibration not cleared");
 playback.SetEnabled(false);playback.CalibrateNeutral();playback.Advance(e);if(playback.State.Error==null)throw new Exception("Disabled calibration accepted");
 using(var exported=JsonDocument.Parse(playback.State.ProfileJson!))if(exported.RootElement.GetProperty("tracking").GetProperty("calibration").EnumerateObject().Any())throw new Exception("Cleared calibration export retained offsets");
 Console.WriteLine("PASS profile export roundtrip, rejected-load preservation, cleared calibration and fresh session");
 Console.WriteLine("PASS neutral capture, centered mapping, clear, stale and disabled rejection");
 Console.WriteLine("PASS tracking latest-only, immutable input, timeout, recovery and disable");
 e.Load(model);RejectTracking(()=>e.MapTracking("{\"timestampMs\":0,\"inputs\":{}}"));
 Console.WriteLine("PASS native tracking face/body independence, partial input, bounds, failed-input preservation and resets");return;
}
if(args.Length>0&&args[0]=="--motion"){
 using var e=new ModelEvaluator();string model=File.ReadAllText("reports/evaluation/model.json");
 using var metaDoc=JsonDocument.Parse(e.Load(model));
 var p=metaDoc.RootElement.GetProperty("parameters").EnumerateArray().First(p=>p.GetProperty("max").GetDouble()>p.GetProperty("min").GetDouble());
 string id=p.GetProperty("id").GetString()!;double min=p.GetProperty("min").GetDouble(),max=p.GetProperty("max").GetDouble();
 string Clip(string kind,string? parameter=null)=>JsonSerializer.Serialize(new{format="standrig-motion",version=1,name="test",duration=1,tracks=new[]{new{parameter=parameter??id,keys=new object[]{new{time=0,value=min,segment=kind=="bezier"?(object)new{kind,control1=new{time=1d/3,value=min+(max-min)/3},control2=new{time=2d/3,value=min+2*(max-min)/3}}:new{kind}},new{time=1,value=max}}}}});
 double Value(double t){using var d=JsonDocument.Parse(e.SampleMotion(t));return d.RootElement.GetProperty(id).GetDouble();}
 void RejectMotion(Action action){try{action();}catch(Microsoft.ClearScript.ScriptEngineException){return;}throw new Exception("Invalid motion accepted");}
 foreach(string kind in new[]{"linear","hold","inverse-hold","bezier"}){
  e.LoadMotion(Clip(kind));double expectedMotion=kind=="hold"?min:kind=="inverse-hold"?max:(min+max)/2;
  if(Value(0)!=min||Value(1)!=max||Math.Abs(Value(.5)-expectedMotion)>1e-9*Math.Max(1,Math.Abs(max-min)))throw new Exception("Motion interpolation mismatch");
 }
 string before=e.SampleMotion(.5);
 RejectMotion(()=>e.LoadMotion(Clip("linear","missing-parameter")));
 RejectMotion(()=>e.LoadMotion(Clip("unsupported")));
 var outside=System.Text.Json.Nodes.JsonNode.Parse(Clip("linear"))!;outside["tracks"]![0]!["keys"]![0]!["value"]=max+1;
 RejectMotion(()=>e.LoadMotion(outside.ToJsonString()));
 RejectMotion(()=>e.LoadMotion("{\"Version\":3}"));
 RejectMotion(()=>e.SampleMotion(-1));RejectMotion(()=>e.SampleMotion(double.NaN));
 if(e.SampleMotion(.5)!=before)throw new Exception("Rejected motion replaced previous clip");
 e.Reset();if(e.SampleMotion(.5)!=before)throw new Exception("Physics reset unexpectedly cleared motion");
 e.Load(model);RejectMotion(()=>e.SampleMotion(0));
 var playback=new MotionPlayback();playback.Submit(MotionAction.Load,Clip("linear"));
 if(playback.Advance(e,0)!=null||playback.State.Active)throw new Exception("Load started playback");
 playback.Submit(MotionAction.Play);playback.Advance(e,1);playback.Advance(e,1.25);
 if(Math.Abs(playback.State.Time-.25)>1e-9)throw new Exception("Playback clock mismatch");
 playback.Submit(MotionAction.Pause);playback.Advance(e,1.5);var held=playback.Advance(e,2);
 if(playback.State.Time!=.5||held==null||playback.State.Running)throw new Exception("Pause did not hold pose");
 playback.Submit(MotionAction.Load,"{}");playback.Advance(e,2.1);
 if(playback.State.Name!="test"||playback.State.Error==null||playback.State.Time!=.5)throw new Exception("Bad load lost playback");
 playback.Submit(MotionAction.Play);playback.Advance(e,3);playback.Advance(e,3.25);
 if(playback.State.Time!=.75)throw new Exception("Resume clock jumped");
 playback.Advance(e,4);if(playback.State.Running||!playback.State.Active||playback.State.Time!=1)throw new Exception("Endpoint hold mismatch");
 playback.Submit(MotionAction.Stop);if(playback.Advance(e,5)!=null||playback.State.Time!=0)throw new Exception("Stop did not remove overlay");
 playback.Submit(MotionAction.Play);playback.Advance(e,6);if(playback.State.Time!=0)throw new Exception("Replay did not restart");
 playback.Configure(2,true);playback.Advance(e,6);playback.Advance(e,6.75);
 if(playback.State.Time!=.5||!playback.State.Running)throw new Exception("Loop/speed lost remainder");
 playback.Submit(MotionAction.Pause);playback.Seek(.25);playback.Advance(e,6.75);playback.Advance(e,7);
 if(playback.State.Time!=.25||playback.State.Running||!playback.State.Active)throw new Exception("Paused seek mismatch");
 playback.Seek(2);playback.Advance(e,7);
 if(playback.State.Time!=.25||playback.State.Error==null)throw new Exception("Invalid seek changed pose");
 playback.Configure(.5,false);playback.Submit(MotionAction.Play);playback.Advance(e,7);playback.Advance(e,7.5);
 if(playback.State.Time!=.5)throw new Exception("Speed change retroactively scaled elapsed time");
 playback.Submit(MotionAction.Stop);playback.Seek(1);playback.Advance(e,7.5);
 if(playback.State.Time!=1||!playback.State.Active||playback.State.Running)throw new Exception("Stopped endpoint seek mismatch");
 foreach(double invalidSpeed in new[]{0d,4.1,double.NaN}){try{playback.Configure(invalidSpeed,false);throw new Exception("Invalid speed accepted");}catch(ArgumentException){}}
 foreach(double invalidTime in new[]{-1d,3601,double.PositiveInfinity}){try{playback.Seek(invalidTime);throw new Exception("Invalid seek accepted");}catch(ArgumentException){}}
 Console.WriteLine("PASS loop remainder, speed changes, paused/stopped seek and invalid bounds");
 Console.WriteLine("PASS playback load/play/pause/resume/end/stop/replay and failed-load preservation");
 Console.WriteLine("PASS motion linear/hold/inverse-hold/bezier, invalid input preservation, reset and model reload");return;
}
if(args.Length>0&&args[0]=="--effects"){
    using var effectEvaluator=new ModelEvaluator();
    using var doc=JsonDocument.Parse(File.ReadAllText("reports/native-effects-fixture.json"));var fixtureRoot=doc.RootElement;
    int width=fixtureRoot.GetProperty("width").GetInt32(),height=fixtureRoot.GetProperty("height").GetInt32();var bytes=fixtureRoot.GetProperty("rgba").EnumerateArray().Select(x=>x.GetByte()).ToArray();long compared=0;
    foreach(var item in fixtureRoot.GetProperty("cases").EnumerateArray()){
        string id=item.GetProperty("id").GetString()!;effectEvaluator.RegisterEffect(id,width,height,bytes,item.GetProperty("config").GetRawText());
        foreach(var step in item.GetProperty("steps").EnumerateArray()){
            var result=effectEvaluator.RenderEffect(id,step.GetProperty("values").GetRawText(),step.GetProperty("ignore").GetBoolean());var effectExpected=step.GetProperty("expected");
            if(effectExpected.ValueKind==JsonValueKind.Null){if(result!=null)throw new Exception("Effect cache mismatch");}
            else{var values=effectExpected.EnumerateArray().Select(x=>x.GetByte()).ToArray();if(result==null||!result.SequenceEqual(values))throw new Exception("Effect bytes mismatch "+id);compared+=values.Length;}
        }
    }
    Console.WriteLine($"PASS exact native image effect bytes: {compared} (tint, reveal, cheek/jaw shade, ignore mask mode, neutral return)");return;
}
var directory=Path.GetFullPath(args.Length>0?args[0]:"reports/evaluation");
var fixture=JsonDocument.Parse(File.ReadAllText(Path.Combine(directory,"fixture.json"))).RootElement;
using var evaluator=new ModelEvaluator();
var meta=evaluator.Load(File.ReadAllText(Path.Combine(directory,"model.json")));
var times=new List<double>();var requests=fixture.GetProperty("requests").EnumerateArray().ToArray();var expected=fixture.GetProperty("expected").EnumerateArray().ToArray();
long numbers=0;
void Compare(JsonElement a,JsonElement b,string path)
{
 if(a.ValueKind!=b.ValueKind)throw new Exception("Type mismatch "+path);
 if(a.ValueKind==JsonValueKind.Number){double x=a.GetDouble(),y=b.GetDouble();if(!double.IsFinite(x)||Math.Abs(x-y)>1e-9*Math.Max(1,Math.Abs(x)))throw new Exception("Numeric mismatch "+path);numbers++;}
 else if(a.ValueKind==JsonValueKind.Object){var ap=a.EnumerateObject().ToArray();var bp=b.EnumerateObject().ToArray();if(ap.Length!=bp.Length)throw new Exception("Object mismatch "+path);foreach(var p in ap)Compare(p.Value,b.GetProperty(p.Name),path+"."+p.Name);}
 else if(a.ValueKind==JsonValueKind.Array){var aa=a.EnumerateArray().ToArray();var ba=b.EnumerateArray().ToArray();if(aa.Length!=ba.Length)throw new Exception("Length mismatch "+path);for(int i=0;i<aa.Length;i++)Compare(aa[i],ba[i],path+"["+i+"]");}
 else if(a.ToString()!=b.ToString())throw new Exception("Value mismatch "+path);
}
for(int i=0;i<requests.Length;i++){var timer=Stopwatch.StartNew();var result=evaluator.Evaluate(requests[i].GetRawText());times.Add(timer.Elapsed.TotalMilliseconds);using var actual=JsonDocument.Parse(result);Compare(expected[i],actual.RootElement,"frame"+i);}
void Reject(string input){try{evaluator.Evaluate(input);}catch(Microsoft.ClearScript.ScriptEngineException){return;}throw new Exception("Invalid input accepted");}
var beforeInvalid=evaluator.Snapshot();
Reject("{\"time\":2,\"values\":{\"does-not-exist\":1}}");
Reject("{\"time\":2,\"physics\":\"yes\"}");
Reject("{\"time\":2,\"values\":[]}");
Reject("{\"time\":-1}");
if(evaluator.Snapshot()!=beforeInvalid)throw new Exception("Rejected input changed state");evaluator.Reset();using(var reset=JsonDocument.Parse(evaluator.Evaluate(requests[0].GetRawText())))Compare(expected[0],reset.RootElement,"reset");
var threadRejected=Task.Run(()=>{try{evaluator.Evaluate(requests[0].GetRawText());return false;}catch(InvalidOperationException){return true;}}).GetAwaiter().GetResult();
if(!threadRejected)throw new Exception("Cross-thread use allowed");
evaluator.Reset();var tickTimes=new List<double>();
for(int i=0;i<requests.Length;i++){var timer=Stopwatch.StartNew();evaluator.Tick(requests[i].GetRawText());tickTimes.Add(timer.Elapsed.TotalMilliseconds);using var snapshot=JsonDocument.Parse(evaluator.Snapshot());Compare(expected[i],snapshot.RootElement,"tick"+i);}
var report=new{ tickWarmMeanMs=tickTimes.Skip(5).Average(),passed=true,frames=requests.Length,numbersCompared=numbers,meanMs=times.Average(),warmMeanMs=times.Skip(5).Average(),maxMs=times.Max(),metadata=JsonDocument.Parse(meta).RootElement,rendererReady=false};
// Compare the packed renderer boundary to the saved pre-optimization detailed fixture.
evaluator.Reset();long packedNumbers=0;
using var reusableEvaluator=new ModelEvaluator();reusableEvaluator.Load(File.ReadAllText(Path.Combine(directory,"model.json")));
float[] reusableVertices=Array.Empty<float>();uint[] reusableIndices=Array.Empty<uint>();
for(int i=0;i<requests.Length;i++){
 var packed=evaluator.Render(requests[i].GetRawText());using var packet=JsonDocument.Parse(packed.Metadata);
 var oldVertices=reusableVertices;var oldIndices=reusableIndices;
 string reusableMetadata=reusableEvaluator.RenderInto(requests[i].GetRawText(),ref reusableVertices,ref reusableIndices);
 if(reusableMetadata!=packed.Metadata||!reusableVertices.SequenceEqual(packed.Vertices)||!reusableIndices.SequenceEqual(packed.Indices))throw new Exception("Reusable render output mismatch");
 if(oldVertices.Length==reusableVertices.Length&&!ReferenceEquals(oldVertices,reusableVertices)||oldIndices.Length==reusableIndices.Length&&!ReferenceEquals(oldIndices,reusableIndices))throw new Exception("Stable buffers not reused");
 var actualMeshes=packet.RootElement.GetProperty("geometry").GetProperty("meshes").EnumerateArray().ToArray();
 var expectedMeshes=expected[i].GetProperty("geometry").GetProperty("meshes").EnumerateArray().ToArray();
 if(actualMeshes.Length!=expectedMeshes.Length)throw new Exception("Packed mesh count mismatch");
 Compare(expected[i].GetProperty("values"),packet.RootElement.GetProperty("values"),"packed values");
 for(int j=0;j<actualMeshes.Length;j++){
  var actualMesh=actualMeshes[j];var expectedMesh=expectedMeshes[j];
  foreach(var property in expectedMesh.EnumerateObject())if(property.Name!="vertices"&&property.Name!="triangles")Compare(property.Value,actualMesh.GetProperty(property.Name),"packed metadata "+property.Name);
  int offset=actualMesh.GetProperty("vertexOffset").GetInt32();
  foreach(var v in expectedMesh.GetProperty("vertices").EnumerateArray())foreach(string component in new[]{"x","y","u","v"}){if(v.GetProperty(component).GetSingle()!=packed.Vertices[offset++])throw new Exception("Packed float mismatch");packedNumbers++;}
  offset=actualMesh.GetProperty("indexOffset").GetInt32();foreach(var index in expectedMesh.GetProperty("triangles").EnumerateArray()){if(index.GetUInt32()!=packed.Indices[offset++])throw new Exception("Packed index mismatch");packedNumbers++;}
 }
}
Console.WriteLine($"PASS packed render arrays: {packedNumbers} numbers against saved detailed fixture");
// Loading a new model must discard prepared validity and pose caches.
var changed=System.Text.Json.Nodes.JsonNode.Parse(File.ReadAllText(Path.Combine(directory,"model.json")))!;
var changedPart=changed["parts"]!.AsArray().First(p=>p?["artMesh"]?["enabled"]?.GetValue<bool>()==true)!;
string changedId=changedPart["id"]!.GetValue<string>();
changedPart["artMesh"]!["triangles"]![0]=99999999;
evaluator.Load(changed.ToJsonString());
using(var invalid=JsonDocument.Parse(evaluator.Evaluate(requests[0].GetRawText()))) {
 if(!invalid.RootElement.GetProperty("geometry").GetProperty("unsupported").EnumerateArray().Any(p=>p.GetProperty("partId").GetString()==changedId))throw new Exception("Reload reused valid mesh cache");
}
evaluator.Load(File.ReadAllText(Path.Combine(directory,"model.json")));
using(var restored=JsonDocument.Parse(evaluator.Evaluate(requests[0].GetRawText())))Compare(expected[0],restored.RootElement,"reload restored");
Console.WriteLine("PASS prepared mesh cache invalidation on valid/invalid/valid model reload");
changed["parts"]!.AsArray().Clear();
reusableEvaluator.Load(changed.ToJsonString());
reusableEvaluator.RenderInto("{\"time\":0,\"physics\":false}",ref reusableVertices,ref reusableIndices);
if(reusableVertices.Length!=0||reusableIndices.Length!=0)throw new Exception("Reusable buffers retained stale geometry after shrink");
reusableEvaluator.Load(File.ReadAllText(Path.Combine(directory,"model.json")));
reusableEvaluator.RenderInto(requests[0].GetRawText(),ref reusableVertices,ref reusableIndices);
evaluator.Reset();var fresh=evaluator.Render(requests[0].GetRawText());
if(!reusableVertices.SequenceEqual(fresh.Vertices)||!reusableIndices.SequenceEqual(fresh.Indices))throw new Exception("Reusable buffers failed to grow after reload");
Console.WriteLine("PASS reusable render parity, stable allocation, empty shrink and model reload growth");
File.WriteAllText(Path.Combine(directory,"native-result.json"),JsonSerializer.Serialize(report,new JsonSerializerOptions{WriteIndented=true}));
Console.WriteLine(JsonSerializer.Serialize(new{report.passed,report.frames,report.numbersCompared,report.meanMs,report.warmMeanMs,report.maxMs,report.tickWarmMeanMs,rendererReady=false}));
