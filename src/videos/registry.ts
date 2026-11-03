import type React from "react";
import { SmokeScene } from "../fixtures/SmokeScene";
import { CacBuoc } from "./mau/cac-buoc";

/** Cảnh của từng video, khoá theo `component` trong kịch bản, dạng "<video>/<cảnh>". */
export const SCENES: Record<string, React.FC> = {
  "fixture/smoke": SmokeScene,
  "mau/cac-buoc": CacBuoc,
};
