import fs from 'node:fs/promises';import vm from 'node:vm';
const context=vm.createContext({});vm.runInContext(await fs.readFile('native/Connect.Evaluation/Resources/evaluator.js','utf8'),context);
const api=context.StandRigEvaluation,width=12,height=20;
const rgba=Array.from({length:width*height*4},(_,i)=>{const p=Math.floor(i/4),x=p%width,y=Math.floor(p/width);return i%4===3?(x===0||y===0?0:180):x===1||x===10?20:[200,150,100][i%4];});
const shade={color:'#804020',width:.2,strength:.8,axisStrength:.5,yawParameter:'Yaw',pitchParameter:'Pitch',maxYaw:30,maxPitch:30,profile:'cheek',farContourFade:.6,nearContourFade:.4,upContourFade:.5,upShadowStrength:.4,lineWidth:.08};
const configs=[{tint:{mode:'multiply',color:'#8040ff',opacity:.6}},{tint:{mode:'screen',color:'#8040ff',opacity:.6}},
 {alphaReveal:{parameter:'Open',closed:0,open:1,exponent:1.3,anchor:.7}},{contourShade:shade},
 {tint:{mode:'multiply',color:'#aaee88',opacity:.5},contourShade:shade,alphaReveal:{parameter:'Open',closed:0,open:1,exponent:1.3,anchor:.5}}];
const cases=configs.map((config,index)=>{
 const id='effect'+index,buffer=api.effectBuffer(rgba.length);buffer.set(rgba);api.registerEffect(id,width,height,buffer,JSON.stringify(config));
 const poses=[{Yaw:0,Pitch:0,Open:1},{Yaw:30,Pitch:-30,Open:.4},{Yaw:-30,Pitch:30,Open:0},{Yaw:15,Pitch:10,Open:.8},{Yaw:0,Pitch:0,Open:1}];
 const steps=poses.flatMap(values=>[false,true].map(ignore=>{const result=api.renderEffect(id,JSON.stringify(values),ignore);return{values,ignore,expected:result?Array.from(result):null};}));
 return{id,config,steps};
});
await fs.mkdir('reports',{recursive:true});await fs.writeFile('reports/native-effects-fixture.json',JSON.stringify({width,height,rgba,cases}));console.log('Created 50 native image-effect comparisons');
