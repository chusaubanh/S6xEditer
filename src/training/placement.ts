import { FPS, secToFrames, type Timeline, type TrainingScript } from "./training-contract";

type Sentence = Timeline["scenes"][number]["sentences"][number];
type Cue = TrainingScript["scenes"][number]["sfx"][number];

/** Khung bắt đầu của tiếng hiệu ứng, tính trong cảnh. Bản video và bản CapCut dùng chung công thức này. */
export const sfxFromFrame = (sentence: Sentence, cue: Cue, fps: number = FPS): number =>
  Math.max(0, Math.round((sentence.startSec + sentence.durationSec * cue.fraction - cue.hitSec) * fps));

export const voiceFromFrame = (sentence: Sentence, fps: number = FPS): number => Math.round(sentence.startSec * fps);

export interface SceneClip { id: string; fromFrame: number; toFrame: number }
export interface AudioItem { src: string; startSec: number; volume: number; lane: number; name: string }

/** Cảnh nối liền nhau theo khung, nên ghép lại đúng bằng tổng số khung của video. */
export function planClips(timeline: Timeline): SceneClip[] {
  const total = secToFrames(timeline.totalSec);
  return timeline.scenes.map((scene, i) => {
    const next = timeline.scenes[i + 1];
    return { id: scene.id, fromFrame: secToFrames(scene.startSec), toFrame: next ? secToFrames(next.startSec) : total };
  });
}

export function planVoice(timeline: Timeline): AudioItem[] {
  return timeline.scenes.flatMap((scene) =>
    scene.sentences.map((sentence, i) => ({
      src: sentence.audio,
      startSec: (secToFrames(scene.startSec) + voiceFromFrame(sentence)) / FPS,
      volume: 1,
      lane: 0,
      name: `${scene.id}-${i}`,
    })),
  );
}

/** Tiếng chồng nhau phải nằm khác làn vì một track CapCut không cho chồng đoạn. */
export function planSfx(script: TrainingScript, timeline: Timeline, durationOf: (src: string) => number): AudioItem[] {
  const items = script.scenes.flatMap((scene) => {
    const timing = timeline.scenes.find((item) => item.id === scene.id);
    if (!timing) throw new Error(`Timeline thiếu cảnh ${scene.id}.`);
    return scene.sfx.map((cue, i) => {
      const sentence = timing.sentences[cue.sentence];
      if (!sentence) throw new Error(`SFX của cảnh ${scene.id} trỏ sai câu.`);
      return { src: cue.src, startSec: (secToFrames(timing.startSec) + sfxFromFrame(sentence, cue)) / FPS, volume: cue.volume, lane: 0, name: `${scene.id}-sfx-${i}` };
    });
  }).sort((a, b) => a.startSec - b.startSec);
  const laneEnds: number[] = [];
  for (const item of items) {
    let lane = laneEnds.findIndex((end) => end <= item.startSec);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = item.startSec + durationOf(item.src);
    item.lane = lane;
  }
  return items;
}

/** Các mốc nhạc đổi mức; giữa hai mốc mức thay đổi tuyến tính nên keyframe tại mốc là đủ. */
export function musicKeyTimes(script: TrainingScript, timeline: Timeline, ramp = 0.35): number[] {
  const music = script.music;
  if (!music) return [];
  const times = new Set([0, music.fadeInSec, timeline.totalSec - music.fadeOutSec, timeline.totalSec]);
  for (const scene of timeline.scenes) {
    const end = scene.startSec + scene.durationSec - script.voice.sceneGapSec;
    for (const t of [scene.startSec - ramp, scene.startSec, end, end + ramp]) if (t >= 0 && t <= timeline.totalSec) times.add(t);
  }
  return [...times].sort((a, b) => a - b);
}
