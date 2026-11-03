import axios, { AxiosError } from "axios";
import { randomUUID } from "node:crypto";
import { dirname, extname } from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { runMediaCommand } from "../media/media-runner.js";
import type { TtsClient } from "./tts-client.js";
import { VIENEU_ENGINE_VERSION } from "./vieneu-voices.js";

export interface VieNeuOpts {
  endpoint: string;
  voice: string;
  style: "tu_nhien" | "tin_tuc" | "doc_truyen";
  /** Playback tempo applied after synthesis (0.5-2.0). 1 or omitted = unchanged. */
  speed?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class VieNeuClient implements TtsClient {
  readonly cacheIdentity: string;

  constructor(private readonly cfg: VieNeuOpts) {
    this.cacheIdentity = [
      "vieneu-v3-turbo",
      // Nâng engine là đổi giọng đọc. Thiếu dòng này, audio cache sinh bởi bản
      // cũ sẽ bị dùng lại lẫn với bản mới (gặp khi lên 3.3.0 → 3.8.3, 08/10/2026).
      `engine=${VIENEU_ENGINE_VERSION}`,
      "onnx-int8",
      cfg.voice,
      cfg.style,
      "seeded-sampling-v1",
      "temperature=0.8",
      "top-k=25",
      ...(cfg.speed && cfg.speed !== 1 ? [`speed=${cfg.speed}`] : []),
    ].join(":");
  }

  private async requestAudio(text: string): Promise<ArrayBuffer> {
    const endpoint = this.cfg.endpoint.replace(/\/+$/, "");
    const response = await axios.post<ArrayBuffer>(
      `${endpoint}/synthesize`,
      {
        text,
        voice: this.cfg.voice,
        style: this.cfg.style,
      },
      {
        headers: { "Content-Type": "application/json", Accept: "audio/wav" },
        responseType: "arraybuffer",
        timeout: 180000,
      },
    );
    return response.data;
  }

  async generate(text: string, audioOutPath: string, _srtOutPath?: string): Promise<void> {
    const delays = [1000, 2000, 4000];
    let lastError: unknown;
    // atempo covers 0.5-2.0 in a single filter pass, which matches the schema's speed range.
    const speed = this.cfg.speed && this.cfg.speed !== 1 ? this.cfg.speed : undefined;

    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const audio = Buffer.from(await this.requestAudio(text));
        await mkdir(dirname(audioOutPath), { recursive: true });
        if (extname(audioOutPath).toLowerCase() === ".wav" && !speed) {
          await writeFile(audioOutPath, audio);
          return;
        }

        const temporaryWav = `${audioOutPath}.${randomUUID()}.wav`;
        try {
          await writeFile(temporaryWav, audio);
          const isWavOut = extname(audioOutPath).toLowerCase() === ".wav";
          const args = ["-y", "-hide_banner", "-loglevel", "error", "-i", temporaryWav];
          if (speed) args.push("-filter:a", `atempo=${speed}`);
          args.push(
            ...(isWavOut ? [audioOutPath] : ["-codec:a", "libmp3lame", "-q:a", "2", audioOutPath]),
          );
          await runMediaCommand("ffmpeg", args);
        } finally {
          await rm(temporaryWav, { force: true });
        }
        return;
      } catch (error) {
        lastError = error;
        const status = (error as AxiosError).response?.status;
        if (status !== undefined && status < 500 && status !== 429) {
          const body = (error as AxiosError).response?.data;
          const detail = Buffer.isBuffer(body)
            ? body.toString("utf8")
            : JSON.stringify(body);
          throw new Error(`VieNeu TTS failed (status ${status}): ${detail}`);
        }
        if (attempt < delays.length) await sleep(delays[attempt]);
      }
    }

    throw lastError;
  }
}
