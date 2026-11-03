import React from "react";
import { AbsoluteFill, Audio, interpolate, Sequence, staticFile, useVideoConfig } from "remotion";
import type { CalculateMetadataFunction } from "remotion";
import { SceneProvider } from "../../kit/scene-context";
import {
  ASPECTS,
  FPS,
  secToFrames,
  TimelineSchema,
  TrainingScriptSchema,
  type Timeline,
  type TrainingScript,
} from "../../training/training-contract";
import { sfxFromFrame, voiceFromFrame } from "../../training/placement";
import { SCENES } from "../../videos/registry";
import { GlobalFonts } from "../GlobalFonts";

export interface TrainingVideoProps extends Record<string, unknown> {
  script: TrainingScript | null;
  timeline: Timeline | null;
  hideText: boolean;
}

export const calculateTrainingMetadata: CalculateMetadataFunction<TrainingVideoProps> = ({ props }) => {
  if (!props.script || !props.timeline) {
    throw new Error("Thiếu kịch bản. Render bằng props.json do `npm run voice` tạo.");
  }
  const script = TrainingScriptSchema.parse(props.script);
  const timeline = TimelineSchema.parse(props.timeline);
  return {
    ...ASPECTS[script.aspect],
    fps: FPS,
    durationInFrames: secToFrames(timeline.totalSec),
  };
};

/** Nhạc nền theo khung: hạ dưới lời đọc, nhích lên ở khoảng nghỉ giữa các cảnh, vào và ra êm. */
export function musicVolume(frame: number, script: TrainingScript, timeline: Timeline): number {
  const music = script.music;
  if (!music) return 0;
  const sec = frame / FPS;
  const ramp = 0.35;
  const speaking = Math.max(
    0,
    ...timeline.scenes.map((scene) => {
      const end = scene.startSec + scene.durationSec - script.voice.sceneGapSec;
      return Math.min(1, Math.max(0, (sec - scene.startSec + ramp) / ramp), Math.max(0, (end + ramp - sec) / ramp));
    }),
  );
  const level = music.inGap + (music.underVoice - music.inGap) * speaking;
  const fade = interpolate(sec, [0, music.fadeInSec, timeline.totalSec - music.fadeOutSec, timeline.totalSec], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return level * fade;
}

export const TrainingVideoComposition: React.FC<TrainingVideoProps> = ({ script, timeline, hideText }) => {
  const { fps } = useVideoConfig();
  if (!script || !timeline) throw new Error("Thiếu kịch bản.");

  return (
    <AbsoluteFill style={{ backgroundColor: "#0C0C0C", color: "#EDEDED", fontFamily: "'Be Vietnam Pro', sans-serif" }}>
      <GlobalFonts />
      {script.music && <Audio src={staticFile(script.music.src)} volume={(frame) => musicVolume(frame, script, timeline)} />}
      {script.scenes.map((scene) => {
        const timing = timeline.scenes.find((item) => item.id === scene.id);
        if (!timing) throw new Error(`Timeline thiếu cảnh ${scene.id}. Chạy lại npm run voice.`);
        const Scene = SCENES[scene.component];
        if (!Scene) throw new Error(`Chưa dựng cảnh "${scene.component}" trong src/videos/registry.ts.`);
        return (
          <Sequence key={scene.id} name={scene.id} from={secToFrames(timing.startSec)} durationInFrames={secToFrames(timing.durationSec)}>
            <SceneProvider value={{ scene, timing, hideText }}>
              <Scene />
            </SceneProvider>
            {timing.sentences.map((sentence) => (
              <Sequence key={sentence.audio} from={voiceFromFrame(sentence, fps)} layout="none">
                <Audio src={staticFile(sentence.audio)} />
              </Sequence>
            ))}
            {scene.sfx.map((cue, i) => {
              const sentence = timing.sentences[cue.sentence];
              if (!sentence) throw new Error(`SFX của cảnh ${scene.id} trỏ sai câu.`);
              const from = sfxFromFrame(sentence, cue, fps);
              return (
                <Sequence key={`${cue.src}-${i}`} from={from} layout="none">
                  <Audio src={staticFile(cue.src)} volume={cue.volume} />
                </Sequence>
              );
            })}
          </Sequence>
        );
      })}
      {/* Watermark thương hiệu nằm trên mọi cảnh của mọi video. */}
      <img src={staticFile("brand/watermark.png")} alt="" style={{ position: "absolute", top: 44, right: 44, width: 84, opacity: 0.4 }} />
    </AbsoluteFill>
  );
};
