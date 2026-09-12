import type { FaceLandmarkerResult, Matrix, NormalizedLandmark } from '@mediapipe/tasks-vision';
import { normalizeTrackingInputValues } from './tracking';
import type { TrackingInputValues } from './types';
export function faceLandmarkerResultToTrackingInput(result: FaceLandmarkerResult): TrackingInputValues {
  const matrixAngles = rotationFromMatrix(result.facialTransformationMatrixes?.[0]);
  const landmarkAngles = matrixAngles ?? rotationFromLandmarks(result.faceLandmarks?.[0]);
  const blendshapes = blendshapeScores(result.faceBlendshapes?.[0]);
  const score = (name: string) => firstFinite(blendshapes.get(name));

  const mouthRound = Math.max(score("mouthFunnel"), score("mouthPucker"));
  const mouthWide = Math.max(score("mouthStretchLeft"), score("mouthStretchRight"));
  const mouthSmile = (score("mouthSmileLeft") + score("mouthSmileRight")) * 0.5;
  const mouthFrown = (score("mouthFrownLeft") + score("mouthFrownRight")) * 0.5;

  // Gaze: positive X = subject looking to their own left. The on-model sign
  // is finalized during the Model Freeze connection QA via mapping.invert.
  const eyeBallX =
    ((score("eyeLookOutLeft") - score("eyeLookInLeft")) + (score("eyeLookInRight") - score("eyeLookOutRight"))) * 0.5;
  const eyeBallY =
    ((score("eyeLookUpLeft") + score("eyeLookUpRight")) - (score("eyeLookDownLeft") + score("eyeLookDownRight"))) * 0.5;

  const browInnerUp = score("browInnerUp");
  const browLY = browInnerUp * 0.5 + score("browOuterUpLeft") * 0.7 - score("browDownLeft");
  const browRY = browInnerUp * 0.5 + score("browOuterUpRight") * 0.7 - score("browDownRight");

  return normalizeTrackingInputValues({
    faceYaw: landmarkAngles?.yaw ?? 0,
    facePitch: landmarkAngles?.pitch ?? 0,
    faceRoll: landmarkAngles?.roll ?? 0,
    bodyYaw: (landmarkAngles?.yaw ?? 0) * 0.55,
    bodyPitch: (landmarkAngles?.pitch ?? 0) * 0.45,
    mouthOpen: firstFinite(blendshapes.get("jawOpen"), blendshapes.get("mouthFunnel"), blendshapes.get("mouthPucker"), 0.12),
    mouthForm: clampSigned(mouthRound - mouthWide),
    mouthSmile: clampSigned(mouthSmile - mouthFrown),
    eyeLOpen: 1 - firstFinite(blendshapes.get("eyeBlinkLeft"), 0),
    eyeROpen: 1 - firstFinite(blendshapes.get("eyeBlinkRight"), 0),
    eyeBallX: clampSigned(eyeBallX),
    eyeBallY: clampSigned(eyeBallY),
    browLY: clampSigned(browLY),
    browRY: clampSigned(browRY),
    cheek: Math.min(1, Math.max(0, score("cheekPuff")))
  });
}

function rotationFromMatrix(matrix: Matrix | undefined): { yaw: number; pitch: number; roll: number } | undefined {
  const data = matrix?.data;
  if (!data || data.length < 16) {
    return undefined;
  }

  const m00 = data[0];
  const m01 = data[1];
  const m02 = data[2];
  const m10 = data[4];
  const m11 = data[5];
  const m12 = data[6];
  const m20 = data[8];
  const m21 = data[9];
  const m22 = data[10];

  const pitch = Math.atan2(-m12, Math.hypot(m02, m22));
  const yaw = Math.atan2(m02, m22);
  const roll = Math.atan2(m10, m00 || m11);
  return normalizeAngles(yaw, pitch, roll);
}

function rotationFromLandmarks(landmarks: NormalizedLandmark[] | undefined): { yaw: number; pitch: number; roll: number } | undefined {
  if (!landmarks?.length) {
    return undefined;
  }

  const leftEye = landmarks[33];
  const rightEye = landmarks[263];
  const nose = landmarks[1];
  const chin = landmarks[152];
  if (!leftEye || !rightEye || !nose || !chin) {
    return undefined;
  }

  const eyeMidX = (leftEye.x + rightEye.x) / 2;
  const eyeMidY = (leftEye.y + rightEye.y) / 2;
  const eyeDistance = Math.max(0.001, Math.abs(rightEye.x - leftEye.x));
  const yaw = (nose.x - eyeMidX) / eyeDistance;
  const pitch = (nose.y - eyeMidY) / Math.max(0.001, Math.abs(chin.y - eyeMidY)) - 0.33;
  const roll = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x);
  return normalizeAngles(yaw, pitch, roll);
}

function normalizeAngles(yaw: number, pitch: number, roll: number) {
  return {
    yaw: clampSigned(yaw / 0.55),
    pitch: clampSigned(pitch / 0.45),
    roll: clampSigned(roll / 0.55)
  };
}

function blendshapeScores(classifications: { categories: Array<{ categoryName: string; score: number }> } | undefined) {
  const scores = new Map<string, number>();
  for (const category of classifications?.categories ?? []) {
    scores.set(category.categoryName, category.score);
  }
  return scores;
}

function firstFinite(...values: Array<number | undefined>): number {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return 0;
}

function clampSigned(value: number): number {
  return Math.min(1, Math.max(-1, Number.isFinite(value) ? value : 0));
}

