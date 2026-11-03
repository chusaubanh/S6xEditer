import { DotLottie } from "@lottiefiles/dotlottie-web";
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { staticFile, useCurrentFrame, useDelayRender, useVideoConfig } from "remotion";

DotLottie.setWasmUrl(staticFile("vendor/dotlottie-player.wasm"));

/** Nhân sự #08: tua dotLottie theo khung, không để tự phát. `data` là JSON Lottie hoặc tệp .lottie. */
export const DotLottieFrame: React.FC<{
  data: string | ArrayBuffer;
  width: number;
  height: number;
  style?: React.CSSProperties;
}> = ({ data, width, height, style }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  const [handle] = useState(() => delayRender("Nạp dotLottie"));
  const [player, setPlayer] = useState<DotLottie | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const instance = new DotLottie({
      canvas: canvasRef.current,
      data,
      autoplay: false,
      loop: false,
      useFrameInterpolation: false,
      renderConfig: { autoResize: false, devicePixelRatio: 1, freezeOnOffscreen: false },
    });
    instance.addEventListener("load", () => setPlayer(instance));
    instance.addEventListener("loadError", (event) => cancelRender(event.error));
    return () => instance.destroy();
    // Chỉ nạp một lần cho mỗi lần gắn cảnh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    if (!player) return;
    const sourceFps = player.totalFrames / Math.max(player.duration, 0.001);
    const target = Math.min((frame / fps) * sourceFps, player.totalFrames - 1);
    player.setFrame(target);
    continueRender(handle);
    // handle không đổi trong suốt vòng đời cảnh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player, frame, fps]);

  return <canvas ref={canvasRef} width={width} height={height} style={{ width, height, ...style }} />;
};
