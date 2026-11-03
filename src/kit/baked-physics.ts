export interface BakedPhysics {
  fps: number;
  bodies: string[];
  /** frames[f][b] = [x, y, z, qx, qy, qz, qw] */
  frames: number[][][];
}

/** Nhân sự #14: cảnh chỉ đọc lại quỹ đạo đã tính trước, không chạy vật lý khi render. */
export function bakedPose(baked: BakedPhysics, frame: number, body: number) {
  const index = Math.min(Math.max(0, frame), baked.frames.length - 1);
  const pose = baked.frames[index]?.[body];
  if (!pose) throw new Error(`Không có dữ liệu vật lý cho vật ${body}.`);
  const [x = 0, y = 0, z = 0, qx = 0, qy = 0, qz = 0, qw = 1] = pose;
  return { position: [x, y, z] as [number, number, number], quaternion: [qx, qy, qz, qw] as [number, number, number, number] };
}
