/**
 * Biểu thức ffmpeg cho project.videoMoves (zoom / kenburns), CÙNG công thức với overlay-runtime.videoState (parity editor ↔ render):
 *   smooth(u) = u²(3−2u); zoom: w = min(smooth(vào), smooth(ra)); z = 1 + (scale−1)·w; Δx,Δy = m·w
 *   kenburns: p = tiến độ tuyến tính, z = 1 + (scale−1)·p·smooth(ra), Δ = m·p·smooth(ra)
 *   kẹp |Δ| ≤ (z−1)/2·100 % canvas để cửa sổ phóng không vượt khung tĩnh (không lộ viền đen).
 * Một lần chạy ffmpeg phục vụ cả chuỗi dài (~25 zoom/2 phút): các đoạn nối bằng if(between(t,s,e),…) lồng nhau, mỗi khung chỉ
 * tính nhánh trúng. pip chưa hỗ trợ ở render (ưu tiên thấp) — bị bỏ qua và báo cảnh báo.
 */
import { clipTransformSpans, effectiveMoves, effectiveShifts } from "./camera.js";
import type { Project } from "./project-schema.js";

/** Nền lộ ra khi video không phủ kín canvas (scale < 1 / dịch quá mép): ink thương hiệu #0C0C0C. */
export const INK = "0x0C0C0C";

const n4 = (v: number) => String(+v.toFixed(4));
const sm = (u: string) => `((${u})*(${u})*(3-2*(${u})))`;

export interface MoveExprs {
  /** hệ số phóng tương đối z(t) (1 = không phóng) */
  z: string;
  /** dịch dx,dy (% canvas) đã kẹp */
  dx: string;
  dy: string;
  count: number;
}

/** tv: biểu thức thời gian ("t" cho libplacebo, "(on/FPS)" cho zoompan); zRef: biểu thức/biến z dùng trong phép kẹp (mặc định chính z). */
export function moveExprs(p: Project, tv: string, zRef?: string): MoveExprs {
  const moves = [...effectiveMoves(p)].filter((m) => m.mode !== "pip").sort((a, b) => a.start - b.start);
  let zN = "0", xN = "0", yN = "0";
  for (let i = moves.length - 1; i >= 0; i--) {
    const m = moves[i];
    const s = m.start, e = m.end, L = e - s;
    const ein = m.ease?.in ?? 0.35, eout = m.ease?.out ?? 0.35;
    const ri = ein > 0 ? sm(`clip((${tv}-${n4(s)})/${n4(ein)},0,1)`) : "1";
    const ro = eout > 0 ? sm(`clip((${n4(e)}-${tv})/${n4(eout)},0,1)`) : "1";
    const sc = m.scale ?? 1, mx = m.x ?? 0, my = m.y ?? 0;
    let w: string;
    if (m.mode === "kenburns") w = `(((${tv}-${n4(s)})/${n4(L)})*${ro})`;
    else w = `min(${ri},${ro})`;
    const gate = `between(${tv},${n4(s)},${n4(e)})`;
    zN = `if(${gate},${n4(sc - 1)}*${w},${zN})`;
    xN = `if(${gate},${n4(mx)}*${w},${xN})`;
    yN = `if(${gate},${n4(my)}*${w},${yN})`;
  }
  const z = `(1+${zN})`;
  const zr = zRef ?? z;
  const lim = `((${zr}-1)*50)`;
  // videoShifts cộng dồn sau bước kẹp; ngoài [start,end] w = 0 nên không cần gate (clip đã đưa về 0)
  const shifts = effectiveShifts(p).filter((s) => s.end > s.start).map((s) => {
    const ein = s.ease?.in ?? 0.5, eout = s.ease?.out ?? 0.5;
    const ri = ein > 0 ? sm(`clip((${tv}-${n4(s.start)})/${n4(ein)},0,1)`) : `gte(${tv},${n4(s.start)})`;
    const ro = eout > 0 ? sm(`clip((${n4(s.end)}-${tv})/${n4(eout)},0,1)`) : `lt(${tv},${n4(s.end)})`;
    return `${n4(s.x)}*min(${ri},${ro})`;
  });
  const sx = shifts.length ? `+${shifts.join("+")}` : "";
  return { z, dx: `(clip(${xN},-${lim},${lim})${sx})`, dy: `clip(${yN},-${lim},${lim})`, count: moves.length + shifts.length };
}

export interface SrcInfo { w: number; h: number }

/** Giá trị khung gốc (scale/x/y) theo t: khung riêng của clip nếu có, ngoài ra videoTransform. Biên clip lệch nửa khung để không phụ thuộc làm tròn pts. */
function baseExpr(p: Project, tv: string, key: "scale" | "x" | "y"): string {
  const h = 0.5 / p.fps;
  let e = n4(p.videoTransform[key] ?? (key === "scale" ? 1 : 0));
  const spans = clipTransformSpans(p);
  for (let i = spans.length - 1; i >= 0; i--) {
    const sp = spans[i];
    e = `if(gte(${tv},${n4(sp.s - h)})*lt(${tv},${n4(sp.e - h)}),${n4(sp.t[key] ?? (key === "scale" ? 1 : 0))},${e})`;
  }
  return e;
}

/** Vị trí/kích thước video hiển thị trên canvas (điểm ảnh) theo t — CÙNG công thức với overlay-runtime.videoState. Không kẹp: tự do, phần trống tô INK. */
export function placementExprs(p: Project, info: SrcInfo, tv: string, zRef?: string): { pw: string; ph: string; px: string; py: string; count: number } {
  const { width: W, height: H } = p;
  const e = moveExprs(p, tv, zRef);
  const cs = Math.max(W / info.w, H / info.h);
  const S = `(${baseExpr(p, tv, "scale")}*${e.z})`;
  const pw = `(${n4(info.w * cs)}*${S})`, ph = `(${n4(info.h * cs)}*${S})`;
  const px = `(${n4(W / 2)}+(${baseExpr(p, tv, "x")}+${e.dx})/100*${n4(W)}-${pw}/2)`;
  const py = `(${n4(H / 2)}+(${baseExpr(p, tv, "y")}+${e.dy})/100*${n4(H)}-${ph}/2)`;
  return { pw, ph, px, py, count: e.count };
}

/** libplacebo (Vulkan, GPU, lanczos): ĐẶT video nguồn vào canvas (pos_*) theo t, phần trống tô INK. Dùng cho mọi khung động / không phủ kín. */
export function libplaceboMoves(p: Project, info: SrcInfo): string {
  const { width: W, height: H } = p;
  const e = placementExprs(p, info, "t");
  return `[0:v]libplacebo=w=${W}:h=${H}:pos_w='${e.pw}':pos_h='${e.ph}':pos_x='${e.px}':pos_y='${e.py}':fillcolor=${INK}:upscaler=lanczos:downscaler=lanczos:format=yuv420p[b0s]`;
}

/** Phương án CPU: scale (eval=frame, theo t) + overlay lên nền INK. Xử lý được scale < 1 và dịch quá mép (zoompan thì không). */
export function scaleOverlayMoves(p: Project, info: SrcInfo): string {
  const { width: W, height: H, fps } = p;
  const e = placementExprs(p, info, "t");
  const even = (x: string) => `max(2,trunc((${x})/2)*2)`;
  return `color=c=${INK}:s=${W}x${H}:r=${fps}:d=${p.duration.toFixed(3)}[base];[0:v]fps=${fps},scale=w='${even(e.pw)}':h='${even(e.ph)}':eval=frame:flags=lanczos,setsar=1[v0];[base][v0]overlay=x='${e.px}':y='${e.py}':eval=frame:shortest=1,format=yuv420p[b0s]`;
}
