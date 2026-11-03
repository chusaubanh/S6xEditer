import { useGsapTimeline } from "@remotion/gsap";
import React from "react";
import { Label, useBeats } from "../../kit/scene-context";

/** Cảnh mẫu: mỗi câu làm một khối hiện ra. Video thật cần cảnh riêng kể được ý của từng câu. */
export const CacBuoc: React.FC = () => {
  const { starts } = useBeats();
  const scope = useGsapTimeline<HTMLDivElement>(({ timeline, selector }) => {
    selector(".beat").forEach((element: Element, i: number) => {
      timeline.fromTo(element, { scaleX: 0, opacity: 0 }, { scaleX: 1, opacity: 1, duration: 0.4, ease: "power2.out" }, (starts[i] ?? 0) / 30);
    });
  });
  return (
    <div ref={scope} style={{ position: "absolute", inset: "11% 8%", display: "flex", flexDirection: "column", gap: "3%" }}>
      {starts.map((_, i) => (
        <div key={i} className="beat" style={{ flex: 1, background: "linear-gradient(90deg, #C5A059, #7A6233)", borderRadius: 28, display: "flex", alignItems: "center", justifyContent: "center", color: "#111", fontSize: 64, fontWeight: 800, transformOrigin: "left center" }}>
          <Label i={i} />
        </div>
      ))}
    </div>
  );
};
