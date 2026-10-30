import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const ctx=vm.createContext({});vm.runInContext(await fs.readFile('native/Connect.Evaluation/Resources/evaluator.js','utf8'),ctx);
const rig={schemaVersion:'0.1.0',name:'Physics clock regression',stage:{width:100,height:100},assets:[],parts:[],deformers:[],
 parameters:[{id:'ParamAngleX',min:-30,max:30,default:0},{id:'ParamHair',min:-1,max:1,default:0}],
 physics:{enabled:true,chains:[{id:'hair',enabled:true,targetPartIds:[],sourceParameters:[{parameter:'ParamAngleX',scale:.02}],stiffness:240,damping:29,mass:1,gravity:0,wind:0,
 output:{property:'x',scale:0},parameterOutput:{parameter:'ParamHair',scale:1,min:-1,max:1},segments:[{id:'tip',length:1,delay:.004,damping:1}]}]}};
function run(fps){ctx.StandRigEvaluation.load(JSON.stringify(rig));const trace=[];for(let i=0;i<=4*fps;i++){
 const time=i/fps;const packet=JSON.parse(ctx.StandRigEvaluation.evaluate(JSON.stringify({time,values:{ParamAngleX:20*Math.sin(time*Math.PI*2)}})));
 const value=packet.values.ParamHair;assert.ok(Number.isFinite(value)&&Math.abs(value)<=1);trace.push(value);
}return trace;}
const high=run(60),low=run(15);
const maxError=Math.max(...low.map((v,i)=>Math.abs(v-high[i*4])));
assert.ok(Math.max(...low.map(Math.abs))>.25,'Physics did not move');
assert.ok(maxError<.04,`Low-FPS physics diverged from 60 Hz: ${maxError}`);
ctx.StandRigEvaluation.evaluate(JSON.stringify({time:100,values:{ParamAngleX:0}}));
const afterPause=JSON.parse(ctx.StandRigEvaluation.evaluate(JSON.stringify({time:100.1,values:{ParamAngleX:0}})));
assert.ok(Number.isFinite(afterPause.values.ParamHair));
console.log(JSON.stringify({passed:true,lowFps:15,referenceFps:60,maxError,suspendedIntervalBounded:true}));
rig.assets=[{id:'pixel',type:'image',width:1,height:1,src:'embedded:png'}];
rig.parts=[{id:'pixel',kind:'image',assetId:'pixel',visible:true,drawOrder:0,parentId:null,transform:{x:0,y:0,rotation:0,scaleX:1,scaleY:1,pivotX:0,pivotY:0,opacity:1}}];
ctx.StandRigEvaluation.load(JSON.stringify(rig));ctx.StandRigEvaluation.renderPacket('{"time":0,"physics":false}');
rig.parts[0].transform.x=1e100;ctx.StandRigEvaluation.load(JSON.stringify(rig));
assert.throws(()=>ctx.StandRigEvaluation.renderPacket('{"time":0,"physics":false}'),/render float overflow/);
console.log('PASS packed output still rejects GPU float overflow');
