import React, { createContext, useContext } from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import type { SceneTiming, TrainingScene } from "../training/training-contract";
import { secToFrames } from "../training/training-contract";

interface SceneContextValue {
  scene: TrainingScene;
  timing: SceneTiming;
  hideText: boolean;
}

const SceneContext = createContext<SceneContextValue | null>(null);
export const SceneProvider = SceneContext.Provider;

function useScene(): SceneContextValue {
  const value = useContext(SceneContext);
  if (!value) throw new Error("Cảnh phải nằm trong SceneProvider.");
  return value;
}

/** Mốc khung bắt đầu của từng câu, tính từ đầu cảnh, lấy từ giọng đo thật. */
export function useBeats(): { starts: number[]; ends: number[]; active: number; at: (sentence: number, fraction?: number) => number } {
  const { timing } = useScene();
  const frame = useCurrentFrame();
  const starts = timing.sentences.map((s) => secToFrames(s.startSec));
  const ends = timing.sentences.map((s) => secToFrames(s.startSec + s.durationSec));
  const active = starts.reduce((current, start, i) => (frame >= start ? i : current), 0);
  const at = (sentence: number, fraction = 0): number => {
    const start = starts[sentence];
    const end = ends[sentence];
    if (start === undefined || end === undefined) throw new Error(`Cảnh không có câu ${sentence}.`);
    return start + (end - start) * fraction;
  };
  return { starts, ends, active, at };
}

/** Khổ hiện tại. Cảnh dùng các số này để bố trí, không ghi cứng 1080. */
export function useLayout() {
  const { width, height } = useVideoConfig();
  const unit = Math.min(width, height) / 100;
  return {
    width,
    height,
    unit,
    landscape: width > height,
    square: width === height,
    portrait: height > width,
  };
}

/**
 * Chữ duy nhất được hiện trên màn hình: lấy theo chỉ số từ `labels` trong kịch bản,
 * nên cổng đối chiếu nguồn kiểm được. Bản `hideText` dùng cho bài tắt chữ của S7.
 */
export const Label: React.FC<{ i: number; style?: React.CSSProperties; className?: string; id?: string }> = ({ i, style, className, id }) => {
  const { scene, hideText } = useScene();
  const text = scene.labels[i];
  if (text === undefined) throw new Error(`Cảnh ${scene.id} không có nhãn số ${i}.`);
  return (
    <span id={id} className={className} style={{ ...style, visibility: hideText ? "hidden" : style?.visibility }}>
      {text}
    </span>
  );
};
