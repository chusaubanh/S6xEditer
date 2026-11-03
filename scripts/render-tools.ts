import { GL } from "../src/training/hardware";
import { bundle } from "@remotion/bundler";
import { ensureBrowser, openBrowser, renderStill, selectComposition } from "@remotion/renderer";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

export interface StillSession {
  shoot(compositionId: string, frame: number, props?: Record<string, unknown>, output?: string): Promise<string>;
  close(): Promise<void>;
}

/** Bundle một lần, mở một trình duyệt, chụp từng khung. */
export async function openStillSession(): Promise<StillSession> {
  await ensureBrowser();
  const serveUrl = await bundle({ entryPoint: resolve("src/remotion/index.ts") });
  const browser = await openBrowser("chrome", { chromiumOptions: { gl: GL } });
  const tempDir = resolve("output", "_tmp-stills");
  mkdirSync(tempDir, { recursive: true });
  let counter = 0;

  return {
    async shoot(compositionId, frame, props = {}, output) {
      const composition = await selectComposition({ serveUrl, id: compositionId, inputProps: props, puppeteerInstance: browser, chromiumOptions: { gl: GL } });
      const target = output ?? join(tempDir, `${counter++}.png`);
      await renderStill({ composition, serveUrl, frame, output: target, inputProps: props, imageFormat: "png", puppeteerInstance: browser, chromiumOptions: { gl: GL } });
      return target;
    },
    async close() {
      await browser.close({ silent: true });
      rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

export const hashFile = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");

/**
 * Bài thử tất định: cùng khung, chụp xuôi rồi chụp ngược, hash phải trùng.
 * Trả về các khung sai.
 */
export async function testDeterminism(
  session: StillSession,
  compositionId: string,
  frames: number[],
  props: Record<string, unknown> = {},
): Promise<number[]> {
  const first = new Map<number, string>();
  for (const frame of frames) first.set(frame, hashFile(await session.shoot(compositionId, frame, props)));
  // Hình không đổi giữa các khung thì trùng hash cũng vô nghĩa: cảnh đang trống hoặc không chạy.
  if (new Set(first.values()).size < 2) throw new Error("Mọi khung giống hệt nhau, cảnh không chuyển động.");
  const failed: number[] = [];
  for (const frame of [...frames].reverse()) {
    if (hashFile(await session.shoot(compositionId, frame, props)) !== first.get(frame)) failed.push(frame);
  }
  return failed;
}
