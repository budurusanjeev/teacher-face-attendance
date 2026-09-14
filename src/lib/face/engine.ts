"use client";

const MODEL_URL = "/models/face-api";
export const MATCH_THRESHOLD = 0.46;
export const AMBIGUITY_GAP = 0.06;

type Point = { x: number; y: number };

export type Challenge = "blink" | "look-left" | "look-right";

export const CHALLENGES: Challenge[] = ["blink", "look-left", "look-right"];

export function randomChallenge(): Challenge {
  return CHALLENGES[Math.floor(Math.random() * CHALLENGES.length)];
}

export function challengeCopy(challenge: Challenge): string {
  switch (challenge) {
    case "blink":
      return "Blink both eyes, slowly, once.";
    case "look-left":
      return "Turn your head to YOUR left, then face the camera again.";
    case "look-right":
      return "Turn your head to YOUR right, then face the camera again.";
  }
}

let loaded = false;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let api: any = null;

async function getApi() {
  if (typeof window === "undefined") {
    throw new Error("Face matching runs only in the tablet browser.");
  }
  if (api) return api;
  const tf = await import("@tensorflow/tfjs");
  await tf.ready();
  if (tf.getBackend() !== "webgl") {
    try {
      await tf.setBackend("webgl");
      await tf.ready();
    } catch {
      /* cpu fallback */
    }
  }
  api = await import("@vladmandic/face-api/dist/face-api.esm.js");
  return api;
}

export async function loadFaceModels() {
  if (loaded) return;
  const faceapi = await getApi();
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
    faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
    faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
  ]);
  loaded = true;
}

export type FaceSample = {
  descriptor: number[];
  box: { x: number; y: number; width: number; height: number };
  landmarks: Point[];
  score: number;
};

export async function detectFaces(
  input: HTMLVideoElement | HTMLCanvasElement,
): Promise<FaceSample[]> {
  const faceapi = await getApi();
  const detections = await faceapi
    .detectAllFaces(
      input,
      new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.45 }),
    )
    .withFaceLandmarks()
    .withFaceDescriptors();
  return detections.map((d: { descriptor: ArrayLike<number>; detection: { box: { x: number; y: number; width: number; height: number }; score: number }; landmarks: unknown }) => ({
    descriptor: Array.from(d.descriptor),
    box: {
      x: d.detection.box.x,
      y: d.detection.box.y,
      width: d.detection.box.width,
      height: d.detection.box.height,
    },
    landmarks: landmarkPoints(d.landmarks),
    score: d.detection.score,
  }));
}

export function landmarkPoints(landmarks: unknown): Point[] {
  if (!landmarks || typeof landmarks !== "object") return [];
  const rec = landmarks as {
    positions?: Array<{ x: number; y: number }>;
    _positions?: Array<{ x: number; y: number }>;
  };
  const raw = rec.positions ?? rec._positions ?? [];
  return Array.from(raw, (p) => ({ x: Number(p.x), y: Number(p.y) }));
}

function dist(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function eyeAspect(points: Point[]) {
  const vertical = dist(points[1], points[5]) + dist(points[2], points[4]);
  const horizontal = dist(points[0], points[3]);
  if (horizontal === 0) return 1;
  return vertical / (2 * horizontal);
}

export function bothEyesOpen(landmarks: Point[]): number {
  const left = eyeAspect(landmarks.slice(36, 42));
  const right = eyeAspect(landmarks.slice(42, 48));
  return (left + right) / 2;
}

export function yawRatio(sample: FaceSample): number {
  const nose = sample.landmarks[30];
  const centerX = sample.box.x + sample.box.width / 2;
  if (sample.box.width === 0) return 0;
  return (nose.x - centerX) / sample.box.width;
}

export function motionScore(
  prev: FaceSample | null,
  next: FaceSample,
): number {
  if (!prev) return 1;
  const a = prev.landmarks[30];
  const b = next.landmarks[30];
  return Math.hypot(a.x - b.x, a.y - b.y) / Math.max(8, next.box.width);
}

function lumaOfCrop(
  video: HTMLVideoElement,
  box: FaceSample["box"],
): number {
  const canvas = document.createElement("canvas");
  const w = Math.max(16, Math.round(box.width));
  const h = Math.max(16, Math.round(box.height));
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext("2d");
  if (!ctx) return 128;
  ctx.drawImage(video, box.x, box.y, w, h, 0, 0, 32, 32);
  const data = ctx.getImageData(0, 0, 32, 32).data;
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return sum / (data.length / 4);
}

function screenLikeVariance(video: HTMLVideoElement, box: FaceSample["box"]): number {
  const canvas = document.createElement("canvas");
  canvas.width = 48;
  canvas.height = 48;
  const ctx = canvas.getContext("2d");
  if (!ctx) return 20;
  ctx.drawImage(video, box.x, box.y, box.width, box.height, 0, 0, 48, 48);
  const data = ctx.getImageData(0, 0, 48, 48).data;
  let laplacian = 0;
  const gray: number[] = [];
  for (let i = 0; i < data.length; i += 4) {
    gray.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
  }
  for (let y = 1; y < 47; y++) {
    for (let x = 1; x < 47; x++) {
      const i = y * 48 + x;
      const v = Math.abs(
        gray[i] * 4 - gray[i - 1] - gray[i + 1] - gray[i - 48] - gray[i + 48],
      );
      laplacian += v;
    }
  }
  return laplacian / (46 * 46);
}

export type QualityFail =
  | "no_face"
  | "many_faces"
  | "too_small"
  | "too_dark"
  | "too_bright"
  | "too_flat";

export function qualityCheck(
  video: HTMLVideoElement,
  samples: FaceSample[],
): QualityFail | null {
  if (samples.length === 0) return "no_face";
  if (samples.length > 1) return "many_faces";
  const face = samples[0];
  const minSide = Math.min(video.videoWidth || 640, video.videoHeight || 480);
  if (face.box.width < minSide * 0.14 || face.box.height < minSide * 0.14) {
    return "too_small";
  }
  const luma = lumaOfCrop(video, face.box);
  if (luma < 28) return "too_dark";
  if (luma > 250) return "too_bright";
  const sharpness = screenLikeVariance(video, face.box);
  // A printed photo or phone screen is often unusually flat / grid-like.
  if (sharpness < 2.2) return "too_flat";
  return null;
}

export function qualityMessage(fail: QualityFail): string {
  switch (fail) {
    case "no_face":
      return "No face in view. Stand in the oval.";
    case "many_faces":
      return "Only one person at a time.";
    case "too_small":
      return "Move closer so your face fills the oval.";
    case "too_dark":
      return "Too dark. Face the light.";
    case "too_bright":
      return "Too bright. Step out of direct glare.";
    case "too_flat":
      return "Live face required. Photos and screens are rejected.";
  }
}

export function euclidean(a: number[], b: number[]): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s);
}

export function averageDescriptor(samples: number[][]): number[] {
  const len = samples[0].length;
  const out = new Array(len).fill(0);
  for (const s of samples) {
    for (let i = 0; i < len; i++) out[i] += s[i];
  }
  for (let i = 0; i < len; i++) out[i] /= samples.length;
  return out;
}

export function matchTeacher(
  descriptor: number[],
  templates: { teacherId: string; embedding: number[] }[],
): { teacherId: string; distance: number } | null {
  const ranked = templates
    .map((t) => ({ teacherId: t.teacherId, distance: euclidean(descriptor, t.embedding) }))
    .sort((a, b) => a.distance - b.distance);
  if (ranked.length === 0) return null;
  const best = ranked[0];
  if (best.distance > MATCH_THRESHOLD) return null;
  const second = ranked[1];
  if (second && second.distance - best.distance < AMBIGUITY_GAP) return null;
  return best;
}

export type LivenessProgress = {
  hint: string;
  blinked: boolean;
  turned: boolean;
};

export function evaluateChallenge(
  challenge: Challenge,
  history: FaceSample[],
): { passed: boolean; progress: LivenessProgress } {
  const ears = history.map((h) => bothEyesOpen(h.landmarks));
  const yaws = history.map((h) => yawRatio(h));
  const openMax = Math.max(...ears, 0);
  const closedMin = Math.min(...ears, 1);
  const blinked = openMax > 0.18 && closedMin < 0.22 && openMax - closedMin > 0.035;

  const yaw0 = yaws[0] ?? 0;
  const yawMin = Math.min(...yaws, 0);
  const yawMax = Math.max(...yaws, 0);
  const turnedLeft = yawMin < yaw0 - 0.1;
  const turnedRight = yawMax > yaw0 + 0.1;

  if (challenge === "blink") {
    return {
      passed: blinked,
      progress: {
        hint: blinked ? "Blink recorded." : "Blink clearly once.",
        blinked,
        turned: false,
      },
    };
  }
  if (challenge === "look-left") {
    return {
      passed: turnedLeft,
      progress: {
        hint: turnedLeft ? "Left turn recorded." : "Turn your head to your left.",
        blinked: false,
        turned: turnedLeft,
      },
    };
  }
  return {
    passed: turnedRight,
    progress: {
      hint: turnedRight ? "Right turn recorded." : "Turn your head to your right.",
      blinked: false,
      turned: turnedRight,
    },
  };
}

export function hasLiveMotion(history: FaceSample[]): boolean {
  if (history.length < 4) return false;
  let travel = 0;
  for (let i = 1; i < history.length; i++) {
    travel += motionScore(history[i - 1], history[i]);
  }
  // A still print taped to the lens barely moves. A blink still moves landmarks.
  return travel > 0.018;
}
