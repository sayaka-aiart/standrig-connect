import { migrateRigDocument } from '@core/migration';
import { prepareRigBindingOrder } from '@core/bindingPreparation';
import { resolveRigFrame } from '@core/evaluator';
import { parameterDefinitionsForRig, defaultParameterValues } from '@core/parameters';
// Added by the pinned-source build adapter; valid only for this immutable session.
import { prepareNativeArtMeshResolver } from '@core/artMesh';
import { applySkinningToVertices } from '@core/skinning';
import { finalGeometry } from './final-geometry';
import { validateFinitePacket } from './finite-packet';
import { initializeTracking } from './tracking-session';
export {loadTrackingProfile,mapTracking,resetTracking,calibrateTracking,exportTrackingProfile} from './tracking-session';
export {convertFace} from './face-input';
import { parseMotion,validateMotionParameters,sampleMotion } from '@core/motion';
let motion:any;
export function loadMotion(json:string){
 if(!rig)throw Error('load a model first');
 const next=parseMotion(JSON.parse(json));validateMotionParameters(next,[...definitions.values()]);
 motion=next;return JSON.stringify({name:next.name,duration:next.duration,parameterIds:next.tracks.map(t=>t.parameter)});
}
export function motionValues(time:number){
 if(!motion)throw Error('no motion');
 if(!Number.isFinite(time)||time<0||time>motion.duration)throw Error('motion time outside clip');
 return JSON.stringify(sampleMotion(motion,time));
}
export { effectBuffer,registerEffect,renderEffect,clearEffects } from './image-effects';
let rig:any, definitions:Map<string,any>, physics=new Map(), lastTime:number|undefined,lastPacket:any;
let samples=0,coreMs=0,geometryMs=0,samplingMs=0,projectionMs=0,validationMs=0;
let meshCache=new Map<string,any>();
export function profile(){return JSON.stringify({samples,coreMs:coreMs/Math.max(1,samples-10),geometryMs:geometryMs/Math.max(1,samples-10),samplingMs:samplingMs/Math.max(1,samples-10),projectionMs:projectionMs/Math.max(1,samples-10),validationMs:validationMs/Math.max(1,samples-10),clock:'Date.now milliseconds; approximate'});}
export function load(json:string){
 const next=prepareRigBindingOrder(migrateRigDocument(JSON.parse(json)));
 const defs=parameterDefinitionsForRig(next);
 const parameterIds=new Set();for(const d of defs){if(parameterIds.has(d.id)||![d.min,d.max,d.default].every(Number.isFinite)||d.min>d.max||d.default<d.min||d.default>d.max)throw Error('invalid parameter definition');parameterIds.add(d.id);}
 if(!Number.isFinite(next.stage.width)||!Number.isFinite(next.stage.height)||next.stage.width<=0||next.stage.height<=0)throw Error('invalid stage');
 const ids=new Set();for(const part of next.parts){if(ids.has(part.id))throw Error('duplicate part');ids.add(part.id);}
 // Complete parse/validation before replacing the current evaluation session.
 rig=next;motion=undefined;definitions=new Map(defs.map(d=>[d.id,d]));physics=new Map();lastTime=undefined;lastPacket=undefined;meshCache.clear();samples=coreMs=geometryMs=samplingMs=projectionMs=validationMs=0;
 initializeTracking(defs);
 return JSON.stringify({contract:1,name:rig.name,parts:rig.parts.length,parameters:defs,stage:rig.stage,rendererReady:false});
}
export function reset(){physics.clear();lastTime=undefined;lastPacket=undefined;}
export function evaluate(json:string){return advance(json,true);}
export function tick(json:string){return advance(json,false);}
export function snapshot(){if(!lastPacket)throw Error("no evaluated frame");return JSON.stringify(lastPacket);}
let vertexBuffer=new Float32Array(0),indexBuffer=new Uint32Array(0);
export function renderVertices(){return vertexBuffer;}
export function renderIndices(){return indexBuffer;}
export function renderPacket(json:string){
 advance(json,false,true);
 const geometry=lastPacket.geometry;
 const vertexCount=geometry.meshes.reduce((n:number,m:any)=>n+m.vertices.length,0),indexCount=geometry.meshes.reduce((n:number,m:any)=>n+m.triangles.length,0);
 if(vertexCount>1000000||indexCount>3000000)throw Error('render packet budget exceeded');
 if(vertexBuffer.length!==vertexCount*4)vertexBuffer=new Float32Array(vertexCount*4);
 if(indexBuffer.length!==indexCount)indexBuffer=new Uint32Array(indexCount);
 let vertexOffset=0,indexOffset=0;
 const meshes=geometry.meshes.map((m:any)=>{
  const {vertices,triangles,...metadata}=m;
  const record={...metadata,vertexOffset,vertexCount:vertices.length,indexOffset,indexCount:triangles.length};
  for(const v of vertices){vertexBuffer[vertexOffset++]=v.x;vertexBuffer[vertexOffset++]=v.y;vertexBuffer[vertexOffset++]=v.u;vertexBuffer[vertexOffset++]=v.v;}
  indexBuffer.set(triangles,indexOffset);indexOffset+=triangles.length;return record;
 });
 return JSON.stringify({contract:1,values:lastPacket.values,geometry:{...geometry,meshes}});
}
function advance(json:string,details:boolean,renderMode=false){
 if(!rig)throw Error('no model');
 const input=JSON.parse(json);if(!input||Array.isArray(input)||typeof input!=='object'||Object.keys(input).some(k=>!['time','values','matrix','physics'].includes(k)))throw Error('invalid request');
 if(input.physics!==undefined&&typeof input.physics!=='boolean')throw Error('invalid physics flag');
 if(input.values!==undefined&&(!input.values||Array.isArray(input.values)||typeof input.values!=='object'))throw Error('invalid values');
 const time=input.time;
 if(!Number.isFinite(time)||time<0||time>1e9)throw Error('invalid time');
 if(lastTime!==undefined&&time<lastTime)throw Error('time must be monotonic; reset before seeking');
 const values={...defaultParameterValues(rig)};
 for(const [id,value] of Object.entries(input.values??{})){const d=definitions.get(id);if(!d||typeof value!=='number'||!Number.isFinite(value)||value<d.min||value>d.max)throw Error('invalid parameter '+id);values[id]=value;}
 const matrix=input.matrix??{a:1,b:0,c:0,d:1,e:0,f:0};
 for(const k of ['a','b','c','d','e','f'])if(!Number.isFinite(matrix[k]))throw Error('invalid matrix');
 const nextPhysics=new Map([...physics].map(([key,value])=>[key,{...value}]));
 const t0=Date.now();
 const frame=resolveRigFrame(rig,values,matrix,{physics:input.physics!==false,physicsState:nextPhysics,physicsTime:time,physicsDt:lastTime===undefined?1/60:Math.min(.05,Math.max(.001,time-lastTime))});
 const t1=Date.now();
 const assets=new Map(rig.assets.map((a:any)=>[a.id,a]));
 const parts=[...rig.parts].sort((a,b)=>a.drawOrder-b.drawOrder).map(part=>{
   const state=frame.parts.get(part.id);const asset:any=assets.get(part.assetId);
   const mesh=asset?.width>0&&asset?.height>0?cachedMesh(part,asset,frame.values):undefined;
   const localMesh=mesh&&part.artMesh?.skinning?{...mesh,vertices:applySkinningToVertices(mesh.vertices,part.artMesh.skinning,frame.skinningTransforms)}:mesh;
   return {id:part.id,drawOrder:part.drawOrder,state,localMesh};
 });
 // localMesh remains available for diagnostics; geometry contains projected post-Glue ArtMesh vertices.
 const projectedAt=Date.now();
 const geometry=finalGeometry(rig,frame,matrix,parts);
 const packet={contract:1,meshStage:'local-skinned-pre-warp-and-glue',geometry,time,values:frame.values,parts,skinningTransforms:[...frame.skinningTransforms],physics:{partOffsets:[...frame.physics.partOffsets],deformerOffsets:[...frame.physics.deformerOffsets],parameterOffsets:frame.physics.parameterOffsets}};
 const t2=Date.now();
 validateFinitePacket(packet);
 if(renderMode){let vertices=0,indices=0;for(const mesh of geometry.meshes){vertices+=mesh.vertices.length;indices+=mesh.triangles.length;for(const v of mesh.vertices)if(![v.x,v.y,v.u,v.v].every(n=>Number.isFinite(Math.fround(n))))throw Error('render float overflow');}if(vertices>1000000||indices>3000000)throw Error('render packet budget exceeded');}
 const result=JSON.stringify(details?packet:{contract:1,time,parts:parts.length,rendererReady:false});
 if(++samples>10){coreMs+=t1-t0;geometryMs+=t2-t1;samplingMs+=projectedAt-t1;projectionMs+=t2-projectedAt;validationMs+=Date.now()-t2;}
 physics=nextPhysics;lastTime=time;lastPacket=packet;return result;
}
function cachedMesh(part:any,asset:any,values:any){
 let entry=meshCache.get(part.id);
 if(!entry){
  const mesh=part.artMesh,list=(v:any)=>Array.isArray(v)?v:[];
  const parameters=[...new Set([...list(mesh?.bindings).map(b=>b?.parameter),...list(mesh?.multiBindings).flatMap(b=>list(b?.parameters)),...list(mesh?.blendShapes).map(b=>b?.parameter)])];
  entry={parameters,previous:null,mesh:undefined,resolve:prepareNativeArtMeshResolver(part,asset.width,asset.height)};meshCache.set(part.id,entry);
 }
 const current=entry.parameters.map((id:string)=>values[id]);
 if(!entry.previous||current.some((v:any,i:number)=>!Object.is(v,entry.previous[i]))){entry.mesh=entry.resolve(values);entry.previous=current;}
 return entry.mesh;
}
