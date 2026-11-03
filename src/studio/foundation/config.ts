import { config as loadDotenv } from "dotenv";

loadDotenv({ path: [".env.local", ".env"], quiet: true });

export type TtsProvider = "vieneu";

export interface Config {
    ttsProvider: TtsProvider;

    // The selected voice/style live in script.json and are reused for all scenes.
    vieneuEndpoint: string;

    ttsConcurrency: number;
}

function intDefault(name: string, def: number): number {
    const v = process.env[name];
    if (!v) return def;
    const n = parseInt(v, 10);
    if (isNaN(n))
        throw new Error(`Env var ${name} must be integer, got "${v}"`);
    return n;
}

export function loadConfig(): Config {
    const provider = (process.env.TTS_PROVIDER ?? "vieneu") as TtsProvider;
    if (provider !== "vieneu") {
        throw new Error(
            `TTS_PROVIDER must be "vieneu", got "${provider}"`,
        );
    }

    return {
        ttsProvider: provider,
        vieneuEndpoint:
            process.env.VIENEU_ENDPOINT ?? "http://127.0.0.1:8124",
        ttsConcurrency: intDefault("TTS_CONCURRENCY", 1),
    };
}
