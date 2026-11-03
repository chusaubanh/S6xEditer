import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runMediaCommand, getMediaDurationSec } from "../media/media-runner.js";

/** Re-export getDurationSec using the unified media runner */
export const getDurationSec = getMediaDurationSec;

/**
 * Concatenate audio files with `gapSec` silence between each, producing a single
 * output mp3.
 *
 * Uses ffmpeg's CONCAT FILTER (not concat demuxer) with explicit sample-rate /
 * channel normalization to avoid clicks/pops at boundaries. Each input is also
 * given a tiny 8 ms fade-in/fade-out which inaudibly smooths any DC offset
 * discontinuity at the boundary — this eliminates the "pét" clicking sound.
 */
export async function concatWithSilence(
  inputPaths: string[],
  gapSec: number,
  outPath: string,
  trailingSilenceSec: number = 0,
): Promise<void> {
  if (inputPaths.length === 0) throw new Error("concatWithSilence: empty inputPaths");
  if (inputPaths.length === 1 && trailingSilenceSec <= 0) {
    // No concat needed — just normalize the single file
    await runMediaCommand("ffmpeg", [
      "-y", "-i", inputPaths[0],
      "-ar", "44100", "-ac", "1",
      "-c:a", "libmp3lame", "-b:a", "192k",
      outPath,
    ]);
    return;
  }

  const tmp = await mkdtemp(join(tmpdir(), "concat-"));
  try {
    // Generate WAV silence (lossless, no encoder priming pops)
    const silencePath = join(tmp, "silence.wav");
    if (gapSec > 0) {
      await runMediaCommand("ffmpeg", [
        "-y", "-f", "lavfi",
        "-i", "anullsrc=r=44100:cl=mono",
        "-t", String(gapSec),
        "-ac", "1", "-ar", "44100",
        silencePath,
      ]);
    }

    let trailingPath: string | undefined;
    if (trailingSilenceSec > 0) {
      if (gapSec > 0 && Math.abs(trailingSilenceSec - gapSec) < 0.001) {
        trailingPath = silencePath;
      } else {
        trailingPath = join(tmp, "trailing_silence.wav");
        await runMediaCommand("ffmpeg", [
          "-y", "-f", "lavfi",
          "-i", "anullsrc=r=44100:cl=mono",
          "-t", String(trailingSilenceSec),
          "-ac", "1", "-ar", "44100",
          trailingPath,
        ]);
      }
    }

    // Build ffmpeg input args + concat filter graph.
    // Interleave: voice[0] silence voice[1] silence voice[2] ... voice[N-1] (trailing silence)
    const ffArgs: string[] = ["-y"];
    const filterParts: string[] = [];
    const labels: string[] = [];
    let idx = 0;
    const FADE_SEC = 0.008; // 8ms — inaudible

    const addInput = (path: string, isSilence = false) => {
      ffArgs.push("-i", path);
      const inLabel = `[${idx}:a]`;
      const outLabel = `a${idx}`;
      if (isSilence) {
        filterParts.push(
          `${inLabel}aresample=44100,aformat=sample_fmts=fltp:channel_layouts=mono[${outLabel}]`,
        );
      } else {
        filterParts.push(
          `${inLabel}aresample=44100,aformat=sample_fmts=fltp:channel_layouts=mono,` +
          `afade=t=in:st=0:d=${FADE_SEC},` +
          `areverse,afade=t=in:st=0:d=${FADE_SEC},areverse[${outLabel}]`,
        );
      }
      labels.push(`[${outLabel}]`);
      idx++;
    };

    inputPaths.forEach((p, i) => {
      addInput(p, false);
      if (i < inputPaths.length - 1 && gapSec > 0) addInput(silencePath, true);
    });

    if (trailingPath) {
      addInput(trailingPath, true);
    }

    const concatFilter = `${labels.join("")}concat=n=${labels.length}:v=0:a=1[out]`;
    const filterGraph = `${filterParts.join(";")};${concatFilter}`;

    ffArgs.push(
      "-filter_complex", filterGraph,
      "-map", "[out]",
      "-c:a", "libmp3lame", "-b:a", "192k", "-ar", "44100",
      outPath,
    );

    await runMediaCommand("ffmpeg", ffArgs);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

export interface SfxMixSpec {
  /** Absolute path to SFX mp3/wav file */
  path: string;
  /** Time in seconds (within voice.mp3) when SFX starts */
  startSec: number;
  /** Volume 0–1 */
  volume: number;
}

/**
 * Mix SFX layer onto an existing voice mp3.
 *
 * - Voice stays at full volume
 * - Each SFX is delayed to its `startSec` and scaled by its `volume`
 * - All SFX layers are summed, then mixed with voice (amix duration=first)
 * - Output is mp3 at 192kbps
 *
 * If `sfxList` is empty, just copies voicePath -> outPath.
 */
export async function mixSfxOntoVoice(
  voicePath: string,
  sfxList: SfxMixSpec[],
  outPath: string,
): Promise<void> {
  if (sfxList.length === 0) {
    // No SFX — just normalize/copy voice
    await runMediaCommand("ffmpeg", [
      "-y", "-i", voicePath,
      "-c:a", "libmp3lame", "-b:a", "192k", "-ar", "44100",
      outPath,
    ]);
    return;
  }

  const ffArgs: string[] = ["-y", "-i", voicePath];
  const filterParts: string[] = [];
  const sfxLabels: string[] = [];

  sfxList.forEach((s, i) => {
    ffArgs.push("-i", s.path);
    const inputIdx = i + 1; // voice is index 0
    const outLabel = `s${i}`;
    const delayMs = Number.isFinite(s.startSec)
      ? Math.max(0, Math.round(s.startSec * 1000))
      : 0;
    const vol = Number.isFinite(s.volume)
      ? Math.max(0, Math.min(1, s.volume))
      : 0.4;
    // Per-SFX chain: resample to 44100 mono -> adelay to start time -> volume
    filterParts.push(
      `[${inputIdx}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=mono,` +
      `adelay=${delayMs}:all=1,volume=${vol}[${outLabel}]`,
    );
    sfxLabels.push(`[${outLabel}]`);
  });

  // Mix all SFX layers together
  let mixedSfxLabel: string;
  if (sfxLabels.length === 1) {
    mixedSfxLabel = sfxLabels[0];
  } else {
    filterParts.push(
      `${sfxLabels.join("")}amix=inputs=${sfxLabels.length}:dropout_transition=0:normalize=0[sfxall]`,
    );
    mixedSfxLabel = "[sfxall]";
  }

  // Voice path: resample, then mix with SFX layer (voice volume 1.0, SFX already scaled)
  filterParts.push(
    "[0:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=mono[voice]",
  );
  filterParts.push(
    `[voice]${mixedSfxLabel}amix=inputs=2:duration=first:dropout_transition=0:normalize=0[out]`,
  );

  ffArgs.push(
    "-filter_complex", filterParts.join(";"),
    "-map", "[out]",
    "-c:a", "libmp3lame", "-b:a", "192k", "-ar", "44100",
    outPath,
  );

  await runMediaCommand("ffmpeg", ffArgs);
}
