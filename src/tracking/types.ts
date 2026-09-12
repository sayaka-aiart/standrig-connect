export type ParameterValues=Record<string,number>;
export interface ParameterDefinition {id:string;label:string;min:number;max:number;default:number;step?:number;group?:string}
export type TrackingInputValues=Record<string,number>;
export type TrackingResponseCurve='linear'|'smoothstep'|'gamma';
export interface OneEuroFilterOptions {minCutoff?:number;beta?:number;derivativeCutoff?:number}
export interface TrackingMapping {id:string;enabled:boolean;source:string;parameter:string;scale:number;offset:number;min?:number;max?:number;smoothing:number;invert?:boolean;deadZone?:number;filter?:'ema'|'one-euro';oneEuro?:OneEuroFilterOptions;responseCurve?:TrackingResponseCurve;responseGamma?:number}
export interface TrackingEyeSync {enabled:boolean;winkThreshold:number;winkCurve?:'hard'|'smoothstep';leftGain?:number;rightGain?:number}
export interface RigTracking {enabled:boolean;provider:'manual'|'mediapipe-face-landmarker';inputSmoothing:number;mappings:TrackingMapping[];calibration?:Record<string,number>;eyeSync?:TrackingEyeSync}
export interface RigDocument {parameters:ParameterDefinition[];tracking?:RigTracking}
