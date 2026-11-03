import { execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

export function resolveMediaBinary(name: "ffmpeg" | "ffprobe"): string {
  const configured =
    name === "ffmpeg" ? process.env.FFMPEG_PATH : process.env.FFPROBE_PATH;
  if (configured) return configured;

  if (process.platform === "win32") {
    const bundled =
      name === "ffmpeg"
        ? join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg.exe")
        : join(
            process.cwd(),
            "node_modules",
            "ffprobe-static",
            "bin",
            "win32",
            "x64",
            "ffprobe.exe",
          );
    if (existsSync(bundled)) return bundled;
  }

  // HyperFrames needs a real path, not a bare name (16/10/2026: an `npm install` pruned the
  // undeclared ffmpeg-static/ffprobe-static mid-batch and renders failed with "FFmpeg not found").
  try {
    const found = execSync(process.platform === "win32" ? `where ${name}` : `command -v ${name}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).split(/\r?\n/)[0].trim();
    if (found && existsSync(found)) return found;
  } catch {
    // not on PATH: fall through to the bare name
  }
  return name;
}

const shortPathCache = new Map<string, string>();

/**
 * On Windows, paths containing non-ASCII characters (Vietnamese diacritics, spaces)
 * can cause issues when passed to tools expecting ASCII or via command line.
 * This dynamically resolves the 8.3 short path using Windows cmd.exe.
 */
export function toAsciiShortPath(filePath: string): string {
  if (process.platform !== "win32" || !filePath) return filePath;

  // If already pure ASCII and has no spaces, return directly
  if (/^[a-zA-Z0-9_.:/\\-]+$/.test(filePath) && !/[\s]/.test(filePath)) {
    return filePath;
  }

  const cached = shortPathCache.get(filePath);
  if (cached) return cached;

  try {
    const absPath = isAbsolute(filePath) ? filePath : resolve(filePath);
    const parentDir = dirname(absPath);
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }

    if (existsSync(absPath)) {
      const cleanPath = absPath.replace(/"/g, "");
      const cmd = `cmd.exe /c for %I in ("${cleanPath}") do @echo %~fsI`;
      const out = execSync(cmd, { encoding: "utf8", windowsHide: true }).trim();
      if (out && existsSync(out)) {
        shortPathCache.set(filePath, out);
        return out;
      }
    } else if (existsSync(parentDir)) {
      const cleanParent = parentDir.replace(/"/g, "");
      const cmd = `cmd.exe /c for %I in ("${cleanParent}") do @echo %~fsI`;
      const dirShort = execSync(cmd, { encoding: "utf8", windowsHide: true }).trim();
      if (dirShort && existsSync(dirShort)) {
        const resolved = join(dirShort, basename(absPath));
        shortPathCache.set(filePath, resolved);
        return resolved;
      }
    }
  } catch {
    // Fall back to original path if short path query fails
  }

  return filePath;
}


