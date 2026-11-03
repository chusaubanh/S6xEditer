/**
 * Máy quay trên video gốc — phần dùng chung cho render (video-moves.ts, render-overlay.ts):
 *  - toggle "Tắt máy quay tự động" (project.camera.aiEnabled=false) bỏ qua mọi move/shift có source "ai";
 *  - khung riêng theo clip (videoClips[].transform) → các đoạn thời gian trên timeline.
 * Công thức khung nguyên GIỐNG clips-core.js (editor) và clipFrames (clips-render.ts).
 */
import { clipFrames } from "./clips-render.js";
import type { Project, VideoMove, VideoShift, VideoTransform } from "./project-schema.js";

export const aiCameraOn = (p: Project): boolean => p.camera?.aiEnabled !== false;
export const effectiveMoves = (p: Project): VideoMove[] => (aiCameraOn(p) ? p.videoMoves : p.videoMoves.filter((m) => m.source !== "ai"));
export const effectiveShifts = (p: Project): VideoShift[] => (aiCameraOn(p) ? p.videoShifts : p.videoShifts.filter((s) => s.source !== "ai"));

export interface TransformSpan { s: number; e: number; t: VideoTransform }
/** Các đoạn [s,e) (giây timeline) có khung riêng. */
export function clipTransformSpans(p: Project): TransformSpan[] {
  if (!p.videoClips?.length) return [];
  return clipFrames(p.videoClips, p.fps)
    .filter((c) => c.clip.transform)
    .map((c) => ({ s: c.startF / p.fps, e: (c.startF + c.n) / p.fps, t: c.clip.transform! }));
}
export const hasClipTransforms = (p: Project): boolean => !!p.videoClips?.some((c) => c.transform);

/** Khung tĩnh toàn cục có phủ kín canvas không (không cần nền ink)? info = kích thước video nguồn. */
export function staticCovers(p: Project, info: { w: number; h: number }): boolean {
  const { width: W, height: H } = p, vt = p.videoTransform;
  const cs = Math.max(W / info.w, H / info.h) * (vt.scale || 1);
  const mx = ((info.w * cs - W) / 2 / W) * 100, my = ((info.h * cs - H) / 2 / H) * 100;
  return (vt.scale || 1) >= 1 - 1e-9 && Math.abs(vt.x || 0) <= mx + 1e-6 && Math.abs(vt.y || 0) <= my + 1e-6;
}
