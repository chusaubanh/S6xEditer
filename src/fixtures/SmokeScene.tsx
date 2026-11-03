import { useGsapTimeline } from "@remotion/gsap";
import React from "react";
import { Label, useBeats, useLayout } from "../kit/scene-context";

/** Cảnh kiểm tra dây chuyền, không phải nội dung đào tạo. Mỗi câu làm một khối hiện ra. */
export const SmokeScene: React.FC = () => {
  const { starts } = useBeats();
  const { unit, landscape, width, height } = useLayout();
  const size = landscape || height / width > 1.5 ? 70 : 40;
  const scope = useGsapTimeline<HTMLDivElement>(({ timeline, selector }) => {
    selector(".beat").forEach((element: Element, i: number) => {
      timeline.fromTo(element, { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.4, ease: "back.out(1.7)" }, (starts[i] ?? 0) / 30);
    });
  });
  // `scope` phải gắn vào thẻ thường: gắn vào AbsoluteFill thì timeline không được dựng.
  return (
    <div ref={scope} style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: landscape ? "row" : "column", gap: unit * 6 }}>
      {starts.map((_, i) => (
        <div key={i} className="beat" style={{ width: unit * size, height: unit * size, background: "#C5A059", borderRadius: unit * 2, display: "flex", alignItems: "center", justifyContent: "center", color: "#0C0C0C", fontWeight: 800, fontSize: unit * 4 }}>
          <Label i={i} />
        </div>
      ))}
    </div>
  );
};
