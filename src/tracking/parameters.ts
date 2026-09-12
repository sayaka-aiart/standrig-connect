import type {RigDocument} from './types.ts';
export const parameterDefinitionsForRig=(rig:RigDocument)=>rig.parameters;
export function clampParameterValue(rig:RigDocument,id:string,value:number){const p=rig.parameters.find(p=>p.id===id);if(!p)throw Error('Unknown parameter '+id);return Math.max(p.min,Math.min(p.max,value));}
