import { resolveGlueWarpForPart } from '@core/glueWarp';
import { resolveGlueStitchOffsets, hasGlueStitches, glueStitchRestScale, applyPartGlueStitchOffset } from '@core/glueVertex';
import { hasSharedWarpFieldEffect } from '@core/sharedWarp';
import { createPartClipResolver, clipMaskPartIds } from '@core/mask';
import { pathGeometry } from './path-geometry';
import { createSharedWarpProjector } from '@core/sharedWarpProjection';
import { hasWarpEffect,warpPoint } from '@core/warp';

// Match the public renderer's projection and stitch order. Texturing/compositing is a separate contract.
export function finalGeometry(rig:any, frame:any, baseMatrix:any, parts:any[]) {
 const assets=new Map(rig.assets.map((a:any)=>[a.id,a]));
 const sourceParts=new Map(rig.parts.map((p:any)=>[p.id,p]));
 const geometries=new Map<string,any>();
 const unsupported:{partId:string;reason:string}[]=[];
 const resolveClip=createPartClipResolver(rig);
 for(const part of rig.parts){if(part.clip){const ids=clipMaskPartIds(part.clip);if(part.clip.mode!=='alpha'||!ids.length||ids.some(id=>{const p:any=sourceParts.get(id);return !p||p.kind!=='image'||!p.assetId;})||![undefined,'rendered','ignore'].includes(part.clip.maskOpacity))throw Error('invalid clip '+part.id);}}
 for(const entry of parts){
  const part:any=sourceParts.get(entry.id);
  if(part.kind!=='image')continue;
  const asset:any=assets.get(part.assetId);
  if(!entry.state||!asset||!(asset.width>0&&asset.height>0)){unsupported.push({partId:entry.id,reason:'missing-asset-or-state'});continue;}
  if(!entry.localMesh&&part.artMesh?.enabled){unsupported.push({partId:entry.id,reason:'invalid-enabled-artmesh'});continue;}
  const warp=resolveGlueWarpForPart(rig,part,entry.state,asset,frame.parts,(p:any)=>assets.get(p.assetId) as any);
  // Match the public image renderer's grid density; generated ids never participate in authored stitches.
  const mesh=entry.localMesh??imageGrid(asset,warp,entry.state.sharedWarps);
  if(mesh.triangles.length%3||mesh.triangles.some((i:number)=>!Number.isInteger(i)||i<0||i>=mesh.vertices.length))throw Error('invalid triangle reference '+entry.id);
  const ids=new Set();for(const v of mesh.vertices){if(ids.has(v.id)||!Number.isFinite(v.x)||!Number.isFinite(v.y)||!Number.isFinite(v.u)||!Number.isFinite(v.v))throw Error('invalid mesh vertex '+entry.id);ids.add(v.id);}
  const context={pose:entry.state.pose,matrix:entry.state.matrix,baseMatrix,sharedWarps:entry.state.sharedWarps,warp,sourceWidth:asset.width,sourceHeight:asset.height};
  const sharedProject=createSharedWarpProjector(context.matrix,context.baseMatrix,context.sharedWarps);
  const left=-context.pose.pivotX*asset.width,top=-context.pose.pivotY*asset.height;
  const bounds={left,top,width:asset.width,height:asset.height},warped=hasWarpEffect(warp);
  const vertices=mesh.vertices.map((v:any)=>{const local={x:left+v.x,y:top+v.y};const p=sharedProject(warped?warpPoint(local.x,local.y,bounds,warp):local);return {x:p.x,y:p.y,id:v.id,u:v.u,v:v.v};});
  const clip=resolveClip(part);
  geometries.set(entry.id,{entry,part,mesh,paths:pathGeometry(part,frame.values,context),clip:clip?{ownerId:clip.owner.id,maskPartIds:clip.maskPartIds,maskOpacity:clip.clip.maskOpacity??'rendered'}:null,vertices,byId:undefined});
 }
 const stitches=hasGlueStitches(rig)?resolveGlueStitchOffsets(rig,{
  values:frame.values,restScale:glueStitchRestScale(baseMatrix),
  projectVertex:(partId:string,vertexId:string)=>{
   const g=geometries.get(partId);
   if(!g||!g.entry.localMesh||!g.entry.state.visible||!(g.entry.state.opacity>0))return undefined;
   // Only stitch endpoints need an ID lookup. Never retain projected positions across frames.
   if(!g.byId){g.byId=new Map();for(const v of g.vertices)g.byId.set(v.id,v);}
   return g.byId.get(vertexId);
  }
 }):undefined;
 const meshes=[...geometries.values()].map(g=>({
  partId:g.part.id,assetId:g.part.assetId,drawOrder:g.part.drawOrder,blendMode:g.part.blendMode??'normal',
  visible:g.entry.state.visible,opacity:g.entry.state.opacity,clip:g.clip,geometrySource:g.entry.localMesh?'artmesh':'image-grid',
  vertices:stitchedVertices(g,stitches?.offsets.get(g.part.id)),
  triangles:g.mesh.triangles,paths:g.paths
 }));
 return {contract:1,coordinateSpace:'projected',stage:'post-warp-and-glue',meshes,unsupported,
  stitchDiagnostics:stitches?{resolvedPairs:stitches.resolvedPairs,skippedPairs:stitches.skippedPairs,maxResidual:stitches.maxResidual}:null,
  rendererReady:false};
}

function stitchedVertices(g:any,offsets:any){
 if(!g.entry.localMesh||!offsets?.size)return g.vertices;
 return g.vertices.map((v:any)=>{if(!offsets.has(v.id))return v;const p=applyPartGlueStitchOffset(offsets,v.id,v);return {x:p.x,y:p.y,id:v.id,u:v.u,v:v.v};});
}

function imageGrid(asset:any,warp:any,sharedWarps:any[]=[]){
 const fields=sharedWarps.filter(hasSharedWarpFieldEffect);
 const columns=Math.max(1,Math.round(warp?.grid.columns??1),...fields.map(f=>f.grid.columns));
 const rows=Math.max(1,Math.round(warp?.grid.rows??1),...fields.map(f=>f.grid.rows));
 if(!Number.isInteger(columns)||!Number.isInteger(rows)||columns>64||rows>64)throw Error('invalid image grid');
 const vertices=[],triangles=[];
 for(let y=0;y<=rows;y++)for(let x=0;x<=columns;x++)vertices.push({id:`image-${x}-${y}`,x:asset.width*x/columns,y:asset.height*y/rows,u:x/columns,v:y/rows});
 for(let y=0;y<rows;y++)for(let x=0;x<columns;x++){const a=y*(columns+1)+x;triangles.push(a,a+1,a+columns+2,a,a+columns+2,a+columns+1);}
 return {vertices,triangles};
}
