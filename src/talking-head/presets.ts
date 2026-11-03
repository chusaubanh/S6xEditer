import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LayerSchema, LayerStyleSchema, type Layer, type LayerStyle } from "./project-schema.js";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export type PresetType = "subtitle" | "lowerThird" | "callout" | "text";
export type AspectKey = "16:9" | "4:5";
export interface PresetLayout { x: number; y: number; w: number; h: number; fontSize?: number }
export interface PresetVariant {
  id: string;
  name: string;
  style: LayerStyle;
  animation: Layer["animation"];
  sfx: { in: string | null; out: string | null };
  layout: Record<AspectKey, PresetLayout>;
}
export interface Preset { id: string; name: string; variants: PresetVariant[] }
export interface SfxMapEntry { category: string; gainDb: number }
export interface SfxPack {
  id: string;
  name: string;
  description: string;
  /** nguồn ưu tiên khi cả thư viện tự sinh và thu thật đều có danh mục đó */
  prefer: "synth" | "kenney";
  in: Record<string, SfxMapEntry | null>;
  out: Record<string, SfxMapEntry | null>;
  emphasis: SfxMapEntry | null;
}
export interface PresetLibrary {
  presets: Record<PresetType, Preset[]>;
  sfxPacks: SfxPack[];
}

let cache: { dir: string; lib: PresetLibrary } | null = null;

export function loadPresets(dir = join(REPO_ROOT, "assets", "th-presets")): PresetLibrary {
  if (cache?.dir === dir) return cache.lib;
  const read = (f: string) => JSON.parse(readFileSync(join(dir, f), "utf8"));
  const presets = {} as Record<PresetType, Preset[]>;
  for (const t of ["subtitle", "lowerThird", "callout", "text"] as const) {
    const j = read(`${t}.json`);
    presets[t] = (j.presets as Preset[]).map((p) => ({
      ...p,
      variants: p.variants.map((v) => ({ ...v, style: LayerStyleSchema.parse(v.style) })),
    }));
  }
  const lib = { presets, sfxPacks: read("sfx-packs.json").packs as SfxPack[] };
  cache = { dir, lib };
  return lib;
}

export function findVariant(presetId: string, variantId: string, lib = loadPresets()): { preset: Preset; variant: PresetVariant; type: PresetType } {
  for (const type of Object.keys(lib.presets) as PresetType[]) {
    const preset = lib.presets[type].find((p) => p.id === presetId);
    if (!preset) continue;
    const variant = preset.variants.find((v) => v.id === variantId);
    if (!variant) throw new Error(`Preset ${presetId} không có biến thể ${variantId}`);
    return { preset, variant, type };
  }
  throw new Error(`Không có preset ${presetId}`);
}

/** 16:9 dùng bố cục ngang; mọi tỷ lệ khác (4:5, 9:16...) rơi về 4:5. */
export function aspectKey(aspect: string): AspectKey {
  return aspect === "16:9" ? "16:9" : "4:5";
}

/**
 * Áp style + animation + meta.preset* của biến thể lên layer; GIỮ text, subtext, words, thời gian, id.
 * Vị trí/kích thước giữ nguyên, trừ khi `opts.aspect` được truyền (layer mới) -> lấy layout mặc định + fontSize.
 */
export function applyPreset(layer: Layer, presetId: string, variantId: string, opts: { aspect?: string } = {}): Layer {
  const { variant } = findVariant(presetId, variantId);
  const out: Layer = {
    ...layer,
    style: { ...variant.style },
    animation: structuredClone(variant.animation),
    meta: { ...layer.meta, presetId, variantId },
  };
  // subtitle: giữ subtitleMode đã có của layer nếu preset không quy định
  if (!variant.animation.subtitleMode && layer.animation.subtitleMode) out.animation.subtitleMode = layer.animation.subtitleMode;
  if (opts.aspect) {
    const l = variant.layout[aspectKey(opts.aspect)];
    Object.assign(out, { x: l.x, y: l.y, w: l.w, h: l.h });
    if (l.fontSize) out.style.fontSize = l.fontSize;
  }
  return LayerSchema.parse(out);
}
