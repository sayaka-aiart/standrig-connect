import {build} from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=JSON.parse(await fs.readFile('scripts/evaluation/source.json','utf8'));
const result=await build({configFile:false,logLevel:'silent',resolve:{alias:{'@core':path.resolve('workspace/vendor/standrig-evaluation',source.commit,'packages/core/src')}},build:{write:false,minify:false,target:'es2022',lib:{entry:path.resolve('scripts/evaluation/render-selection.ts'),name:'Selection',formats:['iife']}}});
const ctx=vm.createContext({});vm.runInContext((Array.isArray(result)?result[0]:result).output[0].code,ctx);
const rig={parts:[{id:'group',kind:'group',clip:{mode:'alpha',maskPartIds:['mask'],maskOpacity:'ignore'}},
 {id:'front',kind:'image',parentId:'group'},{id:'side',kind:'image',parentId:'group'},
 {id:'mask',kind:'image',assetId:'mask-image'},{id:'hidden',kind:'image'}]};
const states=new Map([['front',{visible:true,opacity:1}],['side',{visible:true,opacity:0}],['mask',{visible:false,opacity:0}],['hidden',{visible:false,opacity:1}]]);
const ids=()=>[...ctx.Selection.renderSelection(rig,states)].sort();
assert.deepEqual(ids(),['front','mask']);
states.get('front').opacity=0;states.get('side').opacity=1;assert.deepEqual(ids(),['mask','side']);
states.get('side').visible=false;assert.deepEqual(ids(),[]);
console.log('PASS dormant angle variant culling, hidden inherited mask retention, next-frame activation and empty output');
