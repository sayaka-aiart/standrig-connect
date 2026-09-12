import {faceLandmarkerResultToTrackingInput} from '../../src/tracking/faceInputs';
export function convertFace(json:string){
 const face=JSON.parse(json);
 if(!face||Array.isArray(face)||typeof face!=='object'||Object.keys(face).some(k=>!['Count','Blendshapes','MatrixRowMajor'].includes(k))||![0,1].includes(face.Count))throw Error('invalid face observation');
 if(face.Count===0)return 'null';
 if(!Array.isArray(face.MatrixRowMajor)||face.MatrixRowMajor.length!==16||!face.MatrixRowMajor.every((n:any)=>typeof n==='number'&&Number.isFinite(n)))throw Error('invalid face matrix');
 if(!face.Blendshapes||Array.isArray(face.Blendshapes)||typeof face.Blendshapes!=='object')throw Error('invalid face blendshapes');
 const entries=Object.entries(face.Blendshapes);if(entries.length===0||entries.length>256)throw Error('invalid face blendshape count');
 const categories=entries.map(([categoryName,score])=>{if(!categoryName||typeof score!=='number'||!Number.isFinite(score)||score<0||score>1)throw Error('invalid face score');return {categoryName,score,index:0,displayName:''};});
 return JSON.stringify(faceLandmarkerResultToTrackingInput({faceLandmarks:[],faceBlendshapes:[{categories}],facialTransformationMatrixes:[{rows:4,columns:4,data:face.MatrixRowMajor}]}));
}
