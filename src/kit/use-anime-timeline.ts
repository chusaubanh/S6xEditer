import { createTimeline, svg, type Timeline } from "animejs";
import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";

export interface AnimeBuildContext<T extends Element> {
  timeline: Timeline;
  scope: T;
  /** Bọc một nét SVG để animate thuộc tính draw. */
  drawable: typeof svg.createDrawable;
}

/** Nhân sự #06: dựng timeline Anime.js đang dừng và tua theo khung của Remotion. */
export function useAnimeTimeline<T extends Element>(
  build: (context: AnimeBuildContext<T>) => void,
): RefObject<T> {
  const scopeRef = useRef<T>(null);
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const [timeline, setTimeline] = useState<Timeline | null>(null);

  useLayoutEffect(() => {
    if (!scopeRef.current) return;
    const created = createTimeline({ autoplay: false, defaults: { ease: "outQuad" } });
    build({ timeline: created, scope: scopeRef.current, drawable: svg.createDrawable });
    setTimeline(created);
    return () => {
      created.revert();
    };
    // Timeline chỉ dựng một lần cho mỗi lần gắn cảnh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    timeline?.seek((frame / fps) * 1000, true);
  }, [timeline, frame, fps]);

  return scopeRef;
}
