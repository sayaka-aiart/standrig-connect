import { applyTintChannel, parseTintColor, validatePartTint } from '@core/tint';
import { applyContourShade, validateContourShade } from '@core/contourShade';
import { applyAlphaReveal, validateAlphaReveal } from '@core/alphaReveal';
const effects=new Map<string,any>();
export function clearEffects(){effects.clear();}
export function effectBuffer(length:number){if(!Number.isInteger(length)||length<=0||length>64*1024*1024)throw Error('invalid effect buffer');return new Uint8Array(length);}
export function registerEffect(id:string,width:number,height:number,bytes:Uint8Array,json:string){
 const config=JSON.parse(json);
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<=0||height<=0||width>4096||height>4096||bytes.length!==width*height*4)throw Error('invalid effect dimensions');
 if(config.tint&&validatePartTint(config.tint).length)throw Error('invalid tint');
 if(config.alphaReveal&&!validateAlphaReveal(config.alphaReveal))throw Error('invalid alpha reveal');
 if(config.contourShade&&!validateContourShade(config.contourShade))throw Error('invalid contour shade');
 const data=new Uint8ClampedArray(bytes);
 if(config.tint){const tint=config.tint,color=parseTintColor(tint.color);for(let i=0;i<data.length;i+=4)for(let c=0;c<3;c++)data[i+c]=applyTintChannel(data[i+c],color[c],tint.opacity,tint.mode);}
 effects.set(id,{source:{width,height,data},config,last:[null,null]});
}
export function renderEffect(id:string,json:string,ignoreVisualAlpha:boolean){
 const effect=effects.get(id);if(!effect)throw Error('unknown effect');
 const values=JSON.parse(json);
 if(!values||Array.isArray(values)||typeof values!=='object'||Object.values(values).some(v=>typeof v!=='number'||!Number.isFinite(v)))throw Error('invalid effect values');
 const shaded=ignoreVisualAlpha?effect.source:applyContourShade(effect.source,effect.config.contourShade,values);
 const result=applyAlphaReveal(shaded,effect.config.alphaReveal,values),slot=ignoreVisualAlpha?1:0;
 if(effect.last[slot]===result)return null;
 const bgra=new Uint8Array(result.data.length);
 for(let i=0;i<bgra.length;i+=4){const a=result.data[i+3];bgra[i]=Math.round(result.data[i+2]*a/255);bgra[i+1]=Math.round(result.data[i+1]*a/255);bgra[i+2]=Math.round(result.data[i]*a/255);bgra[i+3]=a;}
 effect.last[slot]=result;return bgra;
}
