import {parseProfile} from '../../src/tracking/profile';
import {captureTrackingCalibration,applyTrackingInput,createTrackingFilterState,DEFAULT_TRACKING_INPUTS} from '../../src/tracking/tracking';
let parameters:any[]|undefined,profile:any,previous:any,filters=createTrackingFilterState(),lastTime:number|undefined;
export function initializeTracking(definitions:any[]){parameters=definitions;profile=undefined;resetTracking();}
export function resetTracking(){previous=Object.fromEntries((parameters??[]).map(p=>[p.id,p.default]));filters=createTrackingFilterState();lastTime=undefined;}
export function loadTrackingProfile(json:string,preserveState=false){
 if(!parameters)throw Error('load a model first');
 const next=parseProfile(JSON.parse(json),parameters);
 profile=next;if(!preserveState)resetTracking();return JSON.stringify({name:next.name,enabled:next.tracking.enabled,mappings:next.tracking.mappings.length});
}
export function mapTracking(json:string){
 if(!profile||!parameters)throw Error('load a tracking profile first');
 const request=JSON.parse(json);
 if(!request||Array.isArray(request)||typeof request!=='object'||Object.keys(request).some(k=>!['timestampMs','inputs'].includes(k)))throw Error('invalid tracking request');
 const time=request.timestampMs,inputs=request.inputs;
 if(!Number.isFinite(time)||time<0||time>1e12||lastTime!==undefined&&time<lastTime)throw Error('invalid tracking timestamp');
 if(!inputs||Array.isArray(inputs)||typeof inputs!=='object')throw Error('invalid tracking inputs');
 for(const [id,value] of Object.entries(inputs)){const d=DEFAULT_TRACKING_INPUTS.find(p=>p.id===id);if(!d||typeof value!=='number'||!Number.isFinite(value)||value<d.min||value>d.max)throw Error('invalid tracking input '+id);}
 const nextFilters={oneEuro:Object.fromEntries(Object.entries(filters.oneEuro).map(([k,v])=>[k,{...v}]))};
 const next=applyTrackingInput({parameters,tracking:profile.tracking},previous,inputs,{filterState:nextFilters,timestampMs:time});
 if(Object.values(next).some(v=>!Number.isFinite(v)))throw Error('non-finite tracking output');
 const result:Record<string,number>={};
 if(profile.tracking.enabled)for(const m of profile.tracking.mappings)if(m.enabled&&inputs[m.source]!==undefined)result[m.parameter]=next[m.parameter];
 filters=nextFilters;previous=next;lastTime=time;return JSON.stringify(result);
}

export function calibrateTracking(json:string){
 if(!profile)throw Error('load a tracking profile first');
 const inputs=JSON.parse(json);
 if(inputs!==null){
  if(!inputs||Array.isArray(inputs)||typeof inputs!=='object')throw Error('invalid calibration input');
  for(const [id,value] of Object.entries(inputs)){const d=DEFAULT_TRACKING_INPUTS.find(p=>p.id===id);if(!d||typeof value!=='number'||!Number.isFinite(value)||value<d.min||value>d.max)throw Error('invalid calibration input '+id);}
 }
 profile={...profile,tracking:{...profile.tracking,calibration:inputs===null?{}:captureTrackingCalibration(inputs)}};
 resetTracking();
}

export function exportTrackingProfile(){
 if(!profile)throw Error('load a tracking profile first');
 return JSON.stringify(profile,null,2);
}
