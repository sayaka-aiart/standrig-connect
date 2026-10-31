// StandRig packed-offset v1 wire adapter. No Node/browser/host APIs are required by embedded V8.
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function bytes(text:string,length:number){
 if(typeof text!=='string'||text.length!==Math.ceil(length/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(text)||text.length/4*3-(text.endsWith('==')?2:text.endsWith('=')?1:0)!==length)throw Error('Invalid packed offset data');
 const result=new Uint8Array(length);let out=0;
 for(let i=0;i<text.length;i+=4){const n=(alphabet.indexOf(text[i])<<18)|(alphabet.indexOf(text[i+1])<<12)|((text[i+2]==='='?0:alphabet.indexOf(text[i+2]))<<6)|(text[i+3]==='='?0:alphabet.indexOf(text[i+3]));
  if(out<length)result[out++]=(n>>>16)&255;if(out<length)result[out++]=(n>>>8)&255;if(out<length)result[out++]=n&255;
 }return result;
}
function vertexOrder(vertices:any[]){
 let a=2166136261,b=3339675911;
 for(const vertex of vertices){if(typeof vertex?.id!=='string')throw Error('Invalid packed vertex ID');const text=`${vertex.id.length}:${vertex.id};`;for(let i=0;i<text.length;i++){a=Math.imul(a^text.charCodeAt(i),16777619);b=Math.imul(b^text.charCodeAt(i),2246822519);}}
 return `ids-v1:${(a>>>0).toString(16)}:${(b>>>0).toString(16)}`;
}
export function unpackModel(value:any,maximumOffsets=8_000_000):any {
 if(!Number.isSafeInteger(maximumOffsets)||maximumOffsets<0||maximumOffsets>8_000_000)throw Error('Invalid packed offset budget');
 if(value?.format==='standrig-bundle'){if(value.version!==1)throw Error('Unsupported model bundle version');value=value.rig;}
 if(value?.format!=='standrig-packed')return value;
 if(value.version!==1||!value.rig||!Array.isArray(value.rig.parts))throw Error('Unsupported packed model');
 let expanded=0;
 const parts=value.rig.parts.map((part:any)=>{
  const mesh=part.artMesh;if(!mesh)return part;
  if(!Array.isArray(mesh.vertices))throw Error('Invalid packed mesh');const order=vertexOrder(mesh.vertices),n=mesh.vertices.length;
  const key=(key:any)=>{
   if(key.packedOffsets===undefined)return key;
   const block=key.packedOffsets;
   if(key.offsets!==undefined||!block||block.version!==1||block.vertexCount!==n||block.order!==order||!['i16','f32','f64'].includes(block.encoding))throw Error('Packed offset topology or encoding mismatch');
   const indices=block.indices??mesh.vertices.map((_:any,i:number)=>i);
   if(!Array.isArray(indices)||indices.length>n||indices.some(i=>!Number.isInteger(i)||i<0||i>=n)||new Set(indices).size!==indices.length)throw Error('Invalid packed offset indices');
   expanded+=indices.length;if(expanded>maximumOffsets)throw Error('Packed model expansion limit exceeded');
   const width=block.encoding==='i16'?2:block.encoding==='f32'?4:8,data=bytes(block.data,indices.length*2*width),view=new DataView(data.buffer);
   const read=(i:number)=>block.encoding==='i16'?view.getInt16(i*width,true)/32:block.encoding==='f32'?view.getFloat32(i*width,true):view.getFloat64(i*width,true);
   const offsets=indices.map((index:number,i:number)=>{const x=read(i*2),y=read(i*2+1);if(!Number.isFinite(x)||!Number.isFinite(y))throw Error('Non-finite packed offsets');return {vertexId:mesh.vertices[index].id,x,y};});
   return Object.fromEntries(Object.entries(key).map(([name,v])=>name==='packedOffsets'?['offsets',offsets]:[name,v]));
  };
  return {...part,artMesh:{...mesh,bindings:mesh.bindings?.map((b:any)=>({...b,keys:b.keys.map(key)})),multiBindings:mesh.multiBindings?.map((b:any)=>({...b,keyforms:b.keyforms.map(key)})),blendShapes:mesh.blendShapes?.map(key)}};
 });return {...value.rig,parts};
}
