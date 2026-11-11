// Rig features through the generated native evaluator (synthetic rigs, no private fixtures): draw order
// groups, keyed draw order, multiply/screen colors in the render packet, standard parameters redirected to
// pendulum inputs and alternate names, and inverted clips.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const ctx=vm.createContext({});vm.runInContext(fs.readFileSync('native/Connect.Evaluation/Resources/evaluator.js','utf8'),ctx);
const E=ctx.StandRigEvaluation;
const near=(a,b,eps=1e-9)=>assert.ok(Math.abs(a-b)<=eps,`${a} != ${b}`);
const transform={x:0,y:0,rotation:0,scaleX:1,scaleY:1,pivotX:0,pivotY:0,opacity:1};
const asset={id:'img',name:'img',type:'image',width:4,height:4,src:'data:,'};
const mesh=()=>({version:1,enabled:true,generator:{preset:'outline',topology:'rect-grid',columns:1,rows:1,alphaThreshold:1,alphaBounds:{left:0,top:0,width:4,height:4}},
 vertices:[{id:'a',x:0,y:0,u:0,v:0},{id:'b',x:4,y:0,u:1,v:0},{id:'c',x:0,y:4,u:0,v:1}],triangles:[0,1,2]});
const image=(id,extra={})=>({id,name:id,kind:'image',assetId:'img',parentId:null,visible:true,drawOrder:0,transform:{...transform},artMesh:mesh(),...extra});
const packet=(values,physics=false,time=0)=>JSON.parse(E.evaluate(JSON.stringify({time,values,physics})));

// A draw order group, a keyed draw order and blend colors.
E.load(JSON.stringify({schemaVersion:'0.1.0',name:'features',stage:{width:200,height:200},assets:[asset],
 parameters:[{id:'Swap',label:'Swap',min:0,max:1,default:0},{id:'Tint',label:'Tint',min:0,max:1,default:0}],deformers:[],
 parts:[
  {id:'group',name:'group',kind:'group',parentId:null,visible:true,drawOrder:300,drawOrderGroup:true,transform:{...transform}},
  image('inGroup1',{parentId:'group',drawOrder:900}),image('inGroup2',{parentId:'group',drawOrder:100}),
  image('keyed',{drawOrder:200,drawOrderBinding:{parameters:['Swap'],keyforms:[{inputs:{Swap:0},value:200},{inputs:{Swap:1},value:400}],rounding:'truncate'}}),
  image('colored',{drawOrder:500,
   blendColors:{multiply:[1,1,1],screen:[0,0,0],parameters:['Tint'],keyforms:[{inputs:{Tint:0}},{inputs:{Tint:1},multiply:[0.5,0.25,1],screen:[0,0.5,0]}]}})],
 physics:{enabled:false,chains:[]}}));
let p=packet({});
assert.deepEqual(p.geometry.meshes.map(m=>m.partId),['keyed','inGroup2','inGroup1','colored'],'group members sort inside their group slot');
assert.equal(p.geometry.meshes.find(m=>m.partId==='colored').colors,null,'neutral colors stay off the packet');
p=packet({Swap:1,Tint:1});
assert.deepEqual(p.geometry.meshes.map(m=>m.partId),['inGroup2','inGroup1','keyed','colored'],'keyed draw order moves the part past the group');
assert.deepEqual(JSON.parse(JSON.stringify(p.geometry.meshes.find(m=>m.partId==='colored').colors)),{multiply:[0.5,0.25,1],screen:[0,0.5,0]});
const render=JSON.parse(E.renderPacket(JSON.stringify({time:0,values:{Tint:1},physics:false})));
assert.deepEqual(JSON.parse(JSON.stringify(render.geometry.meshes.find(m=>m.partId==='colored').colors)),{multiply:[0.5,0.25,1],screen:[0,0.5,0]},'colors reach the native packet');

// A smoother pendulum overwrites ParamAngleX from AngleX; the mouth is authored as ParamMouthOpenY.
const norm={position:{minimum:-10,default:0,maximum:10},angle:{minimum:-57.3,default:0,maximum:57.3}};
const smoother={id:'smooth',inputs:[{parameter:'AngleX',type:'angle',weight:100}],outputs:[{parameter:'ParamAngleX',vertexIndex:1,type:'angle',scale:28,weight:100}],
 particles:[{mobility:1,delay:1,acceleration:1,radius:0},{mobility:0.01,delay:10,acceleration:10,radius:10}],normalization:norm};
const meta=JSON.parse(E.load(JSON.stringify({schemaVersion:'0.1.0',name:'pendulum',stage:{width:10,height:10},assets:[],parts:[],deformers:[],
 parameters:[{id:'ParamAngleX',label:'ParamAngleX',min:-30,max:30,default:0},{id:'AngleX',label:'AngleX',min:-30,max:30,default:0},{id:'ParamMouthOpenY',label:'ParamMouthOpenY',min:0,max:1,default:0}],
 physics:{enabled:true,chains:[],pendulum:{fps:60,settings:[smoother]}}})));
assert.deepEqual(JSON.parse(JSON.stringify(meta.trackingRedirects)),[{from:'ParamAngleX',to:'AngleX',factor:1,viaPendulum:true},{from:'ParamMouthOpen',to:'ParamMouthOpenY',factor:1,viaPendulum:false}]);
let values;for(let frame=0;frame<=180;frame++)values=packet({ParamAngleX:20,ParamMouthOpen:0.8},true,frame/60).values;
near(values.AngleX,20);near(values.ParamMouthOpenY,0.8);
// The head settles where the smoother puts AngleX 20: 20/30 of 57.3 degrees in radians, times 28.
near(values.ParamAngleX,(20/30)*57.3*Math.PI/180*28,1e-3);
E.reset();values=packet({ParamAngleX:20,ParamMouthOpen:0.8},false).values;
assert.equal(values.AngleX,0,'without physics nothing overwrites ParamAngleX, so it is not redirected');
near(values.ParamAngleX,20);near(values.ParamMouthOpenY,0.8);
// A rig carrying its own tracking setup decides where the head and body angles go: head yaw to AngleX and,
// at half the gain, PositionX; body yaw is left out, so it drives nothing.
const withTracking=JSON.parse(E.load(JSON.stringify({schemaVersion:'0.1.0',name:'author',stage:{width:10,height:10},assets:[],parts:[],deformers:[],
 parameters:[{id:'ParamAngleX',label:'ParamAngleX',min:-30,max:30,default:0},{id:'ParamBodyAngleX',label:'ParamBodyAngleX',min:-10,max:10,default:0},{id:'AngleX',label:'AngleX',min:-30,max:30,default:0},{id:'PositionX',label:'PositionX',min:-30,max:30,default:0}],
 tracking:{enabled:true,provider:'manual',inputSmoothing:0,mappings:[{id:'a',enabled:true,source:'faceYaw',parameter:'AngleX',scale:36,offset:0,smoothing:0},{id:'b',enabled:true,source:'faceYaw',parameter:'PositionX',scale:18,offset:0,smoothing:0}]},
 physics:{enabled:true,chains:[],pendulum:{fps:60,settings:[smoother,{...smoother,id:'body',inputs:[{parameter:'PositionX',type:'angle',weight:100}],outputs:[{...smoother.outputs[0],parameter:'ParamBodyAngleX'}]}]}}})));
assert.deepEqual(JSON.parse(JSON.stringify(withTracking.trackingRedirects)),[{from:'ParamAngleX',to:'AngleX',factor:1,viaPendulum:true},{from:'ParamAngleX',to:'PositionX',factor:.5,viaPendulum:true}]);
values=packet({ParamAngleX:20,ParamBodyAngleX:5},true,0).values;
near(values.AngleX,20);near(values.PositionX,10);

// An inverted clip reaches the native renderer as clip.invert; normal clips carry no flag.
E.load(JSON.stringify({schemaVersion:'0.1.0',name:'inverted',stage:{width:20,height:20},assets:[asset],parameters:[],deformers:[],
 parts:[image('mask',{drawOrder:0,visible:false}),image('normal',{drawOrder:1,clip:{mode:'alpha',maskPartIds:['mask'],maskOpacity:'ignore'}}),
  image('inverted',{drawOrder:2,clip:{mode:'alpha',maskPartIds:['mask'],maskOpacity:'ignore',invert:true}})],physics:{enabled:false,chains:[]}}));
const clips=Object.fromEntries(JSON.parse(E.renderPacket(JSON.stringify({time:0,values:{},physics:false}))).geometry.meshes.map(m=>[m.partId,m.clip]));
assert.deepEqual(JSON.parse(JSON.stringify(clips.inverted)),{ownerId:'inverted',maskPartIds:['mask'],maskOpacity:'ignore',invert:true});
assert.equal('invert' in clips.normal,false);
E.load(JSON.stringify({schemaVersion:'0.1.0',name:'bad',stage:{width:20,height:20},assets:[asset],parameters:[],deformers:[],
 parts:[image('mask'),image('bad',{drawOrder:1,clip:{mode:'alpha',maskPartIds:['mask'],invert:'yes'}})],physics:{enabled:false,chains:[]}}));
assert.throws(()=>E.renderPacket(JSON.stringify({time:0,values:{},physics:false})),/invalid clip/);
console.log('PASS draw order groups, keyed draw order, blend colors in the packet, pendulum/mouth redirects and inverted clips');
