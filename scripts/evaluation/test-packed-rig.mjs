import assert from 'node:assert/strict';import fs from 'node:fs/promises';import vm from 'node:vm';
import {unpackModel} from './packed-rig.ts';
const text=await fs.readFile('scripts/evaluation/packed-fixtures.json','utf8');
const fixture=JSON.parse(text.replaceAll('"fixture:png"',JSON.stringify('data:image/png;base64,'+JSON.parse(text).pngBase64)));
const context=vm.createContext({});vm.runInContext(await fs.readFile('native/Connect.Evaluation/Resources/evaluator.js','utf8'),context);
for(const entry of fixture.cases){
 assert.deepEqual(JSON.parse(JSON.stringify(unpackModel(entry.packed))),entry.expected,entry.name);
 const query=JSON.stringify({time:.25,values:{X:.35,Y:-.6},physics:false});
 context.StandRigEvaluation.load(JSON.stringify(entry.expected));const expected=JSON.parse(context.StandRigEvaluation.evaluate(query));
 context.StandRigEvaluation.load(JSON.stringify(entry.packed));assert.deepEqual(JSON.parse(context.StandRigEvaluation.evaluate(query)),expected,entry.name);
 const bundle={format:'standrig-bundle',version:1,rig:entry.packed};context.StandRigEvaluation.load(JSON.stringify(bundle));assert.deepEqual(JSON.parse(context.StandRigEvaluation.evaluate(query)),expected);
}
const packed=fixture.cases[0].packed,change=fn=>{const copy=structuredClone(packed);fn(copy);return copy;};
for(const bad of [change(x=>x.version=2),change(x=>x.rig.parts[0].artMesh.vertices.reverse()),change(x=>x.rig.parts[0].artMesh.vertices[0].id='😁'),change(x=>x.rig.parts[0].artMesh.multiBindings[0].keyforms[0].packedOffsets.data='AA=='),change(x=>x.rig.parts[0].artMesh.multiBindings[0].keyforms[0].packedOffsets.indices=[0,0]),change(x=>x.rig.parts[0].artMesh.multiBindings[0].keyforms[0].packedOffsets.encoding='unknown')])assert.throws(()=>unpackModel(bad));
assert.throws(()=>unpackModel(packed,1),/expansion limit/);
const wrongPadding=change(x=>{const block=x.rig.parts[0].artMesh.multiBindings[0].keyforms[0].packedOffsets;block.data=block.data.replace(/=+$/,m=>'A'.repeat(m.length));});
assert.throws(()=>unpackModel(wrongPadding),/offset data/);
context.StandRigEvaluation.load(JSON.stringify(packed));const before=context.StandRigEvaluation.evaluate('{"time":0,"physics":false}');assert.throws(()=>context.StandRigEvaluation.load(JSON.stringify(change(x=>x.version=2))));assert.equal(context.StandRigEvaluation.evaluate('{"time":0,"physics":false}'),before);
console.log('PASS StandRig-generated f64/f32/i16, sparse/reordered/duplicate offsets, Unicode topology, native V8 without host base64 APIs, corrupt input and failed-load preservation');
