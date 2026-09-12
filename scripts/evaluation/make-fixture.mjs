import fs from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
const root=process.cwd(),dir=path.join(root,'reports/evaluation');await fs.mkdir(dir,{recursive:true});
const modelPath=process.argv[2]??'../StandRig/examples/sample.standrig.json';
const model=await fs.readFile(modelPath,'utf8');
const context=vm.createContext({});vm.runInContext(await fs.readFile('native/Connect.Evaluation/Resources/evaluator.js','utf8'),context);
const metadata=JSON.parse(context.StandRigEvaluation.load(model));
const values=Object.fromEntries(metadata.parameters.map(p=>[p.id,p.default]));
const requests=[];
for(let i=0;i<60;i++){
 const pose={...values};for(const id of ['ParamAngleX','ParamAngleY','ParamAngleZ','ParamMouthOpen','ParamEyeLOpen']){const p=metadata.parameters.find(p=>p.id===id);if(p)pose[id]=p.min+(p.max-p.min)*(1+Math.sin(i*.2))/2;}
 requests.push({time:i/60,values:pose,physics:true,matrix:{a:1.3,b:.1,c:-.2,d:1.1,e:12,f:-6}});
}
const expected=requests.map(r=>JSON.parse(context.StandRigEvaluation.evaluate(JSON.stringify(r))));
await fs.writeFile(path.join(dir,'model.json'),model);await fs.writeFile(path.join(dir,'fixture.json'),JSON.stringify({requests,expected}));
console.log(JSON.stringify({parts:metadata.parts,frames:requests.length,directory:dir}));
