import { readRigArtPaths,resolveArtPath } from '@core/artPath';
import { projectArtMeshVertex } from '@core/glueVertex';
// Project in the same order as serverRenderer.drawArtPaths. Paths do not inherit ArtMesh skinning/stitches.
export function pathGeometry(part:any,values:any,context:any){
 const scale=Math.max(.01,Math.sqrt(Math.abs(context.matrix.a*context.matrix.d-context.matrix.b*context.matrix.c)));
 return readRigArtPaths(part).flatMap(path=>{
  const p=resolveArtPath(path,values,context.sourceWidth,context.sourceHeight);if(!p)return [];
  const points=p.points.map(v=>projectArtMeshVertex({x:v.u*context.sourceWidth,y:v.v*context.sourceHeight},context));
  const centers:{x:number;y:number}[]=[];
  const segment=(a:any,b:any)=>{
   const count=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)*1.5));
   if(!Number.isFinite(count)||centers.length+count+1>100000)throw Error('path stamp budget exceeded');
   for(let i=0;i<=count;i++){const t=i/count;centers.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});}
  };
  if(p.curve==='smooth'&&points.length>2){for(let i=0;i<points.length-1;i++){
   const a=points[i],b=points[i+1],count=Math.max(4,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/3));let last=a;
   for(let j=1;j<=count;j++){const t=j/count,s=1-t;const next={x:s*s*a.x+2*s*t*a.x+t*t*b.x,y:s*s*a.y+2*s*t*a.y+t*t*b.y};segment(last,next);last=next;}
  }}else for(let i=1;i<points.length;i++)segment(points[i-1],points[i]);
  if(p.closed)segment(points[points.length-1],points[0]);
  return [{id:p.id,color:p.strokeColor,radius:Math.max(.5,Math.max(.5,p.strokeWidth*scale)/2),centers}];
 });
}
