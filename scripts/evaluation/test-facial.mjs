import {build} from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=JSON.parse(await fs.readFile('scripts/evaluation/source.json','utf8'));
const vendor=path.resolve('workspace/vendor/standrig-evaluation',source.commit);
const result=await build({configFile:false,logLevel:'silent',resolve:{alias:{'@standrig/core':path.join(vendor,'packages/core/src')}},build:{write:false,minify:false,target:'es2022',lib:{entry:path.join(vendor,'packages/runtime/src/facial.ts'),name:'Reference',formats:['iife']}}});
const ref=vm.createContext({structuredClone});vm.runInContext((Array.isArray(result)?result[0]:result).output[0].code,ref);
const native=vm.createContext({});vm.runInContext(await fs.readFile('native/Connect.Evaluation/Resources/evaluator.js','utf8'),native);
const api=native.StandRigEvaluation,rig=JSON.parse(await fs.readFile('scripts/evaluation/facial-fixture.json','utf8'));
const metadata=JSON.parse(api.load(JSON.stringify(rig))),base=Object.fromEntries(metadata.parameters.map(p=>[p.id,p.default]));
const reference=new ref.Reference.FacialController(rig);
let numbers=0;
const command=(request,time)=>{api.facialCommand(JSON.stringify(request),time);reference.command(request,time*1000);};
const frame=(time,values={},overrides={})=>{
 const input={...base,...values},expected={...reference.evaluate(input,time*1000),...overrides};
 const actual=JSON.parse(api.evaluate(JSON.stringify({time,values:input,overrides,physics:false}))).values;
 for(const [id,value] of Object.entries(expected)){assert.ok(Math.abs(actual[id]-value)<1e-10,`${time} ${id}: ${actual[id]} != ${value}`);numbers++;}
 return actual;
};
command({action:'expression',id:'half'},0);
for(let i=0;i<=60;i++)frame(i/60,{ParamEyeLOpen:i%7===0?0:.8,ParamAngleX:30*Math.sin(i)});
command({action:'expression',id:'smile'},1);
command({action:'visemes',weights:{A:1,I:1}},1);
for(let i=61;i<=120;i++)frame(i/60,{ParamMouthOpen:.2,ParamEyeLOpen:.6});
assert.equal(frame(2).ParamMouthOpen,.65);
assert.equal(frame(2,{}, {ParamMouthOpen:.25}).ParamMouthOpen,.25);
command({action:'clear',layer:'viseme'},2);
frame(2.04,{ParamMouthOpen:.7});assert.equal(frame(2.2,{ParamMouthOpen:.7}).ParamMouthOpen,.1);
command({action:'clear'},2.2);assert.equal(frame(2.5,{ParamMouthOpen:.7}).ParamMouthOpen,.7);
command({action:'viseme',id:'Silence'},2.5);assert.equal(frame(2.6).ParamMouthOpen,0);
command({action:'clear',immediate:true},2.6);assert.equal(frame(2.6,{ParamMouthOpen:.8}).ParamMouthOpen,.8);
const state=api.facialState(2.6);
for(const request of [{action:'expression',id:'unknown'},{action:'expression',id:'half',strength:2},{action:'visemes',weights:{X:1}},{action:'clear',extra:true}]){assert.throws(()=>api.facialCommand(JSON.stringify(request),2.6));assert.equal(api.facialState(2.6),state);}
const packet=api.snapshot();assert.throws(()=>api.evaluate('{"time":3,"overrides":{"ParamMouthOpen":2}}'));assert.equal(api.snapshot(),packet);
const invalid=structuredClone(rig);invalid.facialPresets.expressions[0].document.Parameters[0].Id='unknown';assert.throws(()=>api.load(JSON.stringify(invalid)));assert.equal(api.facialCatalog(),JSON.stringify(rig.facialPresets));
api.reset();assert.equal(JSON.parse(api.facialState(0)).expressionId,null);
const old=structuredClone(rig);delete old.facialPresets;api.load(JSON.stringify(old));assert.deepEqual(JSON.parse(api.facialCatalog()),{version:1,expressions:[]});
const plain=JSON.parse(api.evaluate(JSON.stringify({time:0,values:base,physics:false}))).values;assert.deepEqual(plain,base);
// The same runtime supports authored vowel Blend Shape channels.
const blend=structuredClone(rig);blend.parameters=['ParamA','ParamI'].map(id=>({id,label:id,min:0,max:1,default:0,step:.01}));
blend.facialPresets.visemes={mode:'blend-shape',fadeInTime:0,fadeOutTime:0,presets:[{id:'A',values:{ParamA:1,ParamI:0}},{id:'I',values:{ParamA:0,ParamI:1}},{id:'Silence',values:{ParamA:0,ParamI:0}}]};
api.load(JSON.stringify(blend));api.facialCommand('{"action":"visemes","weights":{"A":0.6,"I":0.4}}',0);
const mixed=JSON.parse(api.evaluate('{"time":0,"physics":false}')).values;assert.equal(mixed.ParamA,.6);assert.equal(mixed.ParamI,.4);
// Boundary samples must not exceed an authored parameter maximum through roundoff.
api.loadMotion(JSON.stringify({format:'standrig-motion',version:1,name:'bound',duration:1,tracks:[{parameter:'ParamAngleX',keys:[{time:0,value:30},{time:1,value:30}]}]}));
assert.equal(JSON.parse(api.motionValues(.37)).ParamAngleX,30);
console.log(`PASS shared StandRig/Connect facial parity: ${numbers} values; live blink, motion input, fades, mixtures, manual priority, clear, old models, validation, Blend Shapes, motion bound`);
