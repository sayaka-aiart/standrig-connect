import fs from 'node:fs/promises';import path from 'node:path';import {pathToFileURL} from 'node:url';import {createHash} from 'node:crypto';
const root=path.resolve(process.argv[2]??'../StandRig'),modulePath=path.join(root,'packages/core/dist/packedRig.js');
const {packRigDocument,unpackRigDocument}=await import(pathToFileURL(modulePath));
const {createRectArtMesh}=await import(pathToFileURL(path.join(root,'packages/core/dist/artMesh.js')));
const {DEFAULT_TRANSFORM}=await import(pathToFileURL(path.join(root,'packages/core/dist/types.js')));
const {encodePng,createBlankRgba}=await import(pathToFileURL(path.join(root,'packages/core/dist/png.js')));
const image=createBlankRgba(64,64);for(let i=0;i<image.data.length;i+=4)image.data.set([70,140,210,255],i);
const fixture=()=>{const mesh=createRectArtMesh(64,64,{preset:'face-feature',columns:1,rows:1});delete mesh.generator.quality;mesh.vertices[0].id='😀';mesh.vertices[1].id='😁';
 mesh.multiBindings=[{parameters:['X','Y'],keyforms:[-1,1].flatMap(X=>[-1,1].map(Y=>({offsets:mesh.vertices.map((v,i)=>({vertexId:v.id,x:X*(i+.123456789123),y:Y*(i+.25)/32})),metadata:'after offsets',inputs:{X,Y}})))}];
 return {schemaVersion:'0.1.0',name:'Packed interoperability',stage:{width:64,height:64},assets:[{id:'pixel',type:'image',width:64,height:64,src:'fixture:png'}],parameters:['X','Y'].map(id=>({id,label:id,min:-1,max:1,default:0})),parts:[{id:'triangle',name:'Synthetic',kind:'image',parentId:null,assetId:'pixel',visible:true,drawOrder:0,transform:{...DEFAULT_TRANSFORM},artMesh:mesh}],deformers:[],physics:{enabled:false,chains:[]}};
};
const cases=[];for(const encoding of ['lossless','f32','i16','sparse','duplicate']){
 const rig=fixture(),keys=rig.parts[0].artMesh.multiBindings[0].keyforms;
 if(encoding==='sparse')keys[0].offsets=[keys[0].offsets[2],keys[0].offsets[0]];
 if(encoding==='duplicate')keys[0].offsets.push({...keys[0].offsets[0],x:3});
 const packed=packRigDocument(rig,['sparse','duplicate'].includes(encoding)?'lossless':encoding,0),expected=unpackRigDocument(JSON.parse(JSON.stringify(packed)));
 cases.push({name:encoding,packed,expected});
}
await fs.writeFile('scripts/evaluation/packed-fixtures.json',JSON.stringify({format:'standrig-connect-packed-interop-v1',pngBase64:Buffer.from(encodePng(image)).toString('base64'),source:{module:'packages/core/dist/packedRig.js',sha256:createHash('sha256').update(await fs.readFile(modulePath)).digest('hex')},cases},null,2)+'\n');
