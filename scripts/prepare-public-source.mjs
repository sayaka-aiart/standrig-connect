import {readFile,writeFile,mkdir,lstat,realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('..',import.meta.url));
const parse=s=>JSON.parse(s.replace(/^\uFEFF/,''));
const files=parse(await readFile(path.join(root,'scripts/public-source-files.json'),'utf8'));
const destination=path.resolve(process.argv[2]??path.join(root,'reports/public-source-candidate'));
try {await lstat(destination);throw Error('Destination already exists; use a new directory');} catch(e){if(e.code!=='ENOENT')throw e;}
const sha=b=>createHash('sha256').update(b).digest('hex');
const safe=p=>typeof p==='string'&&!p.includes('\\')&&!path.isAbsolute(p)&&p.split('/').every(s=>s&&s!=='.'&&s!=='..');
const prepared=[],seen=new Set();
const rootReal=await realpath(root);
for(const item of files){
 const {source,target}=item;
 if(!safe(source)||!safe(target)||seen.has(target.toLowerCase()))throw Error('Invalid/duplicate manifest path');
 seen.add(target.toLowerCase());
 if(/(^|\/)(bin|obj|workspace|reports|dist|node_modules|\.git)(\/|$)/i.test(target)||/\.(psd|psb|png|jpg|jpeg|dll|exe|task|whl|pdb)$/i.test(target))throw Error('Private/generated file in manifest: '+target);
 const filename=path.join(root,source),stat=await lstat(filename);
 const resolved=await realpath(filename);
 if(!stat.isFile()||stat.isSymbolicLink()||!resolved.startsWith(rootReal+path.sep))throw Error('Unsafe source: '+source);
 const bytes=await readFile(filename),text=bytes.toString('utf8');
 if(/[A-Z]:[\\/]Users[\\/]|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,}|data:image\/[a-z]+;base64,[A-Za-z0-9+/]{100,}/i.test(text))throw Error('Review private content in '+source);
 prepared.push({target,bytes});
}
const evaluator=prepared.find(p=>p.target==='native/Connect.Evaluation/Resources/evaluator.js');
const provenance=parse(prepared.find(p=>p.target==='native/Connect.Evaluation/Resources/provenance.json').bytes.toString());
if(sha(evaluator.bytes)!==provenance.sha256||evaluator.bytes.length!==provenance.bytes)throw Error('Evaluator provenance mismatch');
await mkdir(destination,{recursive:true});
const hashes={};
for(const {target,bytes} of prepared){const out=path.join(destination,target);await mkdir(path.dirname(out),{recursive:true});await writeFile(out,bytes);hashes[target]=sha(bytes);}
await writeFile(path.join(destination,'SHA256SUMS.json'),JSON.stringify(hashes,null,2)+'\n');
console.log(JSON.stringify({destination,files:prepared.length,bytes:prepared.reduce((s,p)=>s+p.bytes.length,0),evaluatorSha256:provenance.sha256},null,2));
