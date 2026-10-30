import {createPartClipResolver} from '@core/mask';

/** Cull dormant angle variants, while retaining even hidden mask sources. */
export function renderSelection(rig:any,states:Map<string,any>){
 const required=new Set<string>(),resolveClip=createPartClipResolver(rig);
 for(const part of rig.parts){
  const state=states.get(part.id);
  if(part.kind!=='image'||!state?.visible||!(state.opacity>0))continue;
  required.add(part.id);
  const clip=resolveClip(part);
  for(const id of clip?.maskPartIds??[])required.add(id);
 }
 return required;
}
