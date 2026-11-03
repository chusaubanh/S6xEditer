/** Chọn GPU hay CPU một lần cho cả pipeline. S6X_REQUIRE_GPU=1 trong .env.local: thiếu GPU thì dừng, không lùi về CPU. */
import { spawnSync } from "node:child_process";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const hasNvenc = (): boolean => {
  if (process.env.S6X_FORCE_CPU === "1") return false;
  if (spawnSync("nvidia-smi", ["-L"], { encoding: "utf8" }).status !== 0) return false;
  return (spawnSync("ffmpeg", ["-hide_banner", "-encoders"], { encoding: "utf8" }).stdout ?? "").includes("h264_nvenc");
};

export const GPU = hasNvenc();
if (!GPU) {
  if (process.env.S6X_REQUIRE_GPU === "1") throw new Error("Máy này đặt S6X_REQUIRE_GPU=1 nhưng không dùng được NVENC. Kiểm tra driver NVIDIA và FFmpeg.");
  console.warn("CẢNH BÁO: không có GPU NVIDIA, chạy bằng CPU nên chậm hơn nhiều.");
}

export const GL = GPU ? ("angle" as const) : ("swangle" as const);
export const REMOTION_FLAGS = [`--gl=${GL}`, `--hardware-acceleration=${GPU ? "required" : "disable"}`];
export const H264_ARGS = GPU ? ["-c:v", "h264_nvenc", "-preset", "p5", "-cq", "18"] : ["-c:v", "libx264", "-preset", "medium", "-crf", "18"];
