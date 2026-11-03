export interface TtsClient {
  /** Stable identity included in audio cache keys. */
  readonly cacheIdentity: string;

  /**
   * Generate speech audio for `text` and write to `audioOutPath` (mp3 or wav).
   * If `srtOutPath` is provided AND the provider supports subtitles,
   * write the SRT to that path. Otherwise silently skip.
   */
  generate(text: string, audioOutPath: string, srtOutPath?: string): Promise<void>;
}

import type { Config } from "../foundation/config.js";
import type { TemplateScript } from "../render/template-script-schema.js";
import { VieNeuClient } from "./vieneu-client.js";

export function createTtsClient(
  cfg: Config,
  voice: TemplateScript["voice"],
): TtsClient {
  return new VieNeuClient({
    endpoint: cfg.vieneuEndpoint,
    voice: voice.preset,
    style: voice.style,
    speed: voice.speed,
  });
}
