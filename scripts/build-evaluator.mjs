import {readFile, mkdir, writeFile, copyFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {build} from 'vite';
const root=fileURLToPath(new URL('..',import.meta.url));
const source=JSON.parse(await readFile(path.join(root,'scripts/evaluation/source.json'),'utf8'));
const repository=path.resolve(process.argv[2]??path.join(root,'../StandRig'));
const vendor=path.join(root,'workspace/vendor/standrig-evaluation',source.commit);
await mkdir(vendor,{recursive:true});
const archive=path.join(vendor,'source.tar');
execFileSync('git',['-C',repository,'archive','--format=tar','--output',archive,source.commit,'packages/core/src','LICENSE','NOTICE']);
execFileSync('tar',['-xf',archive,'-C',vendor]);
const output=path.join(root,'native/Connect.Evaluation/Resources');
// Derive a read-only prepared resolver from the pinned implementation, preserving
// its private samplers and arithmetic. Never patch the source repository/archive.
const preparedMesh={name:'native-prepared-artmesh',enforce:'pre',transform(code,id){
 if(id.replaceAll('\\','/').endsWith('/packages/core/src/motion.ts')){
  // Motion is validated JSON only; embedded V8 has no browser structuredClone global.
  if(!code.includes('return structuredClone(value)'))throw Error('Pinned motion clone contract changed');
  return code.replace('return structuredClone(value)','return JSON.parse(JSON.stringify(value))');
 }
 if(!id.replaceAll('\\','/').endsWith('/packages/core/src/artMesh.ts'))return;
 const start=code.indexOf('export function resolveArtMesh('),end=code.indexOf('export function isValidArtMesh(',start);
 if(start<0||end<0)throw Error('Pinned ArtMesh resolver boundary changed');
 const original=code.slice(start,end),bodyStart=original.indexOf('  const offsets =');
 const guard='  const mesh = part.artMesh;\n  if (!mesh?.enabled || !isValidArtMesh(mesh, width, height)) {\n    return undefined;\n  }\n';
 if(bodyStart<0||!original.replaceAll('\r\n','\n').includes(guard))throw Error('Pinned ArtMesh validation contract changed');
 const body=original.slice(bodyStart).trimEnd();
 if(!body.endsWith('}'))throw Error('Pinned ArtMesh resolver ending changed');
 const samplerStart=code.indexOf('function sampleArtMeshBinding('),offsetStart=code.indexOf('function offsetsForKey(',samplerStart),offsetEnd=code.indexOf('function applyOffsets(',offsetStart);
 if(samplerStart<0||offsetStart<0||offsetEnd<0)throw Error('Pinned ArtMesh sampler boundary changed');
 const sampler=code.slice(samplerStart,offsetStart),offsetBuilder=code.slice(offsetStart,offsetEnd).replace('function offsetsForKey(', 'function buildKeyOffsets(');
 // Only immutable authored offsets are cached. Sampled/interpolated maps remain frame-local.
 const preparation=`const keyOffsets=new WeakMap<object,Map<string,{x:number;y:number}>>();\n${offsetBuilder}\nfunction offsetsForKey(key:RigArtMeshBinding["keys"][number]){let result=keyOffsets.get(key);if(!result){result=buildKeyOffsets(key);keyOffsets.set(key,result);}return result;}\n${sampler}`;
 const factory=`\nexport function prepareNativeArtMeshResolver(part: RigPart,width:number,height:number) {\n const mesh=part.artMesh;\n if(!mesh?.enabled || !isValidArtMesh(mesh,width,height)) return (_values:ParameterValues)=>undefined;\n${preparation}\n return (values:ParameterValues):ResolvedArtMesh|undefined=>{\n${body.slice(0,-1)}\n };\n}\n`;
 return code+factory;
}};
await build({configFile:false,logLevel:'warn',plugins:[preparedMesh],resolve:{alias:{'@core':path.join(vendor,'packages/core/src')}},build:{target:'es2022',minify:false,emptyOutDir:false,outDir:output,lib:{entry:path.join(root,'scripts/evaluation/entry.ts'),name:'StandRigEvaluation',formats:['iife'],fileName:()=> 'evaluator.js'}}});
const bytes=await readFile(path.join(output,'evaluator.js'));
await writeFile(path.join(output,'provenance.json'),JSON.stringify({...source,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length},null,2)+'\n');
await copyFile(path.join(vendor,'LICENSE'),path.join(output,'STANDRIG-LICENSE'));
await copyFile(path.join(vendor,'NOTICE'),path.join(output,'STANDRIG-NOTICE'));
await copyFile(path.join(root,'node_modules/zod/LICENSE'),path.join(output,'ZOD-LICENSE'));
console.log(JSON.stringify({commit:source.commit,bytes:bytes.length,output}));
