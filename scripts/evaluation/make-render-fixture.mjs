import fs from 'node:fs/promises';
import {deflateSync} from 'node:zlib';
// A derived test fixture only. Never rewrites the public sample or the user's model.
const rig=JSON.parse(await fs.readFile(process.argv[2]??'../StandRig/examples/sample.standrig.json','utf8'));
await fs.mkdir('reports',{recursive:true});
await fs.writeFile('reports/native-render-images.json',JSON.stringify(rig));
for(const part of rig.parts){
 if(part.kind!=='image')continue;
 const {width:w,height:h}=rig.assets.find(a=>a.id===part.assetId);
 part.artMesh={version:1,enabled:true,generator:{preset:'outline',columns:1,rows:1,alphaThreshold:1,alphaBounds:{left:0,top:0,width:w,height:h}},
 vertices:[[0,0],[1,0],[1,1],[0,1]].map(([u,v],i)=>({id:'v'+i,x:u*w,y:v*h,u,v})),triangles:[0,1,2,0,2,3]};
}
await fs.mkdir('reports',{recursive:true});
await fs.writeFile('reports/native-render-sample.json',JSON.stringify(rig));
const rejected=structuredClone(rig);rejected.parts.find(p=>p.kind==='image').blendMode='unsupported';
await fs.writeFile('reports/native-render-unsupported.json',JSON.stringify(rejected));
console.log('Created sample/image/pixel/mask fixtures and invalid-blend fixture in reports');

// Procedural pixel test with known UV quadrants and translucent overlap.
function png(width,height,pixel){
 const crc=bytes=>{let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;};
 const chunk=(type,bytes)=>{const data=Buffer.concat([Buffer.from(type),bytes]),head=Buffer.alloc(4),tail=Buffer.alloc(4);head.writeUInt32BE(bytes.length);tail.writeUInt32BE(crc(data));return Buffer.concat([head,data,tail]);};
 const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
 const raw=Buffer.alloc((width*4+1)*height);for(let y=0;y<height;y++)for(let x=0;x<width;x++)Buffer.from(pixel(x,y)).copy(raw,y*(width*4+1)+1+x*4);
 return 'data:image/png;base64,'+Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]).toString('base64');
}
const pixels=structuredClone(rig);pixels.name='Native pixel contract';pixels.stage={width:640,height:480,background:'transparent'};
pixels.assets=[{id:'uv',width:64,height:64,type:'image',name:'uv',src:png(64,64,(x,y)=>y<32?(x<32?[255,0,0,255]:[0,255,0,255]):(x<32?[0,0,255,255]:[255,255,0,255]))},
 {id:'over',width:64,height:64,type:'image',name:'over',src:png(64,64,()=>[0,0,255,128])}];
pixels.parts=[0,1].map(i=>({id:'p'+i,name:'p'+i,kind:'image',assetId:i?'over':'uv',parentId:null,visible:true,drawOrder:i,
 transform:{x:i?96:64,y:i?96:64,rotation:0,scaleX:1,scaleY:1,pivotX:0,pivotY:0,opacity:i?.5:1},
 artMesh:{version:1,enabled:true,generator:{preset:'outline',columns:1,rows:1,alphaThreshold:1,alphaBounds:{left:0,top:0,width:64,height:64}},vertices:[[0,0],[1,0],[1,1],[0,1]].map(([u,v],n)=>({id:'v'+n,x:u*64,y:v*64,u,v})),triangles:[0,1,2,0,2,3]}}));
await fs.writeFile('reports/native-render-pixels.json',JSON.stringify(pixels));

const masked=structuredClone(pixels);masked.name='Native grouped alpha union';
masked.assets.push(...[['red',[255,0,0,255]],['blue',[0,0,255,255]],['mask',[255,255,255,128]]].map(([id,color])=>({id,name:id,type:'image',width:64,height:64,src:png(64,64,()=>color)})));
const imagePart=(id,asset,x,opacity=1)=>({id,name:id,kind:'image',assetId:asset,parentId:null,visible:true,drawOrder:0,transform:{x,y:64,rotation:0,scaleX:1,scaleY:1,pivotX:0,pivotY:0,opacity}});
const group={id:'group',kind:'group',name:'group',parentId:null,visible:true,drawOrder:-1,transform:{x:0,y:0,rotation:0,scaleX:1,scaleY:1,pivotX:0,pivotY:0,opacity:1},clip:{mode:'alpha',maskPartIds:['mask-a','mask-b'],maskOpacity:'ignore'}};
masked.parts=[group,imagePart('red','red',64),imagePart('blue','blue',64,.5),imagePart('mask-a','mask',64),imagePart('mask-b','mask',96),imagePart('control','uv',256)];
masked.parts.forEach((p,i)=>p.drawOrder=i);
masked.parts[1].parentId=masked.parts[2].parentId='group';masked.parts[3].visible=masked.parts[4].visible=false;
await fs.writeFile('reports/native-render-masks.json',JSON.stringify(masked));
masked.parts[0].clip.maskOpacity='rendered';await fs.writeFile('reports/native-render-hidden-mask.json',JSON.stringify(masked));

const effects=structuredClone(pixels);effects.name='Native effects';
effects.assets.push({id:'skin',name:'skin',type:'image',width:64,height:64,src:png(64,64,()=>[200,100,50,255])});
effects.parts=[imagePart('control','uv',256),imagePart('tinted','skin',64),imagePart('shade','skin',160)];
effects.parts[1].tint={mode:'multiply',color:'#80ff00',opacity:.5};effects.parts[1].alphaReveal={parameter:'ParamMouthOpen',closed:0,open:1,exponent:1,anchor:.5};
effects.parts[2].contourShade={color:'#000000',width:.2,strength:1,axisStrength:1,yawParameter:'ParamAngleZ',pitchParameter:'ParamAngleY',maxYaw:25,maxPitch:30};
await fs.writeFile('reports/native-render-effects.json',JSON.stringify(effects));
const blends=structuredClone(pixels);blends.name='Native blend equations';blends.parts=[];
blends.assets=[{id:'dest',name:'dest',type:'image',width:64,height:64,src:png(64,64,()=>[80,120,160,128])},{id:'src',name:'src',type:'image',width:64,height:64,src:png(64,64,()=>[160,80,40,128])}];
for(const [i,mode] of ['normal','multiply','screen','additive'].entries()){const x=64+i*120;const d=imagePart('d'+i,'dest',x),s=imagePart('s'+i,'src',x+16);d.drawOrder=i*2;s.drawOrder=i*2+1;s.blendMode=mode;blends.parts.push(d,s);}
await fs.writeFile('reports/native-render-blends.json',JSON.stringify(blends));

const paths=structuredClone(pixels);paths.name='Native art paths';
paths.assets.push({id:'blank',name:'blank',type:'image',width:64,height:64,src:png(64,64,()=>[0,0,0,0])});
paths.parts=[imagePart('control','uv',256),imagePart('path','blank',64,.25)];
paths.parts[1].artPaths=[{version:1,id:'line',name:'line',enabled:true,curve:'polyline',closed:false,strokeColor:'#ff000080',strokeWidth:6,opacity:1,
 points:[{id:'a',u:.25,v:.25},{id:'b',u:.75,v:.25}],bindings:[{parameter:'ParamMouthOpen',property:'offsetY',keys:[{input:0,value:0},{input:1,value:20}]}]},
 {version:1,id:'closed',name:'closed',enabled:true,curve:'smooth',closed:true,strokeColor:'#00ff00ff',strokeWidth:2,opacity:1,points:[{id:'a',u:.1,v:.7},{id:'b',u:.5,v:.8},{id:'c',u:.9,v:.7}]}];
await fs.writeFile('reports/native-render-paths.json',JSON.stringify(paths));
