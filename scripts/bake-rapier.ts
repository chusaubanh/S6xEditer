/**
 * Nhân sự #14 - Rapier: tính trước quỹ đạo trong Node, cảnh chỉ phát lại theo khung.
 * tsx scripts/bake-rapier.ts <spec.json> <ra.json>
 */
import RAPIER from "@dimforge/rapier3d-compat";
import { readFileSync, writeFileSync } from "node:fs";

export interface PhysicsSpec {
  frames: number;
  fps: number;
  gravity?: number;
  floorY?: number;
  bodies: { name: string; position: [number, number, number]; halfExtents: [number, number, number]; rotationZ?: number }[];
}

const clean = (value: number): number => Math.round(value * 1e5) / 1e5;

export async function bakePhysics(spec: PhysicsSpec) {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: spec.gravity ?? -9.81, z: 0 });
  world.timestep = 1 / spec.fps;
  world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, (spec.floorY ?? -2) - 0.5, 0));
  const bodies = spec.bodies.map((body) => {
    const half = (body.rotationZ ?? 0) / 2;
    const rigid = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(...body.position)
        .setRotation({ x: 0, y: 0, z: Math.sin(half), w: Math.cos(half) }),
    );
    world.createCollider(RAPIER.ColliderDesc.cuboid(...body.halfExtents), rigid);
    return rigid;
  });

  const frames: number[][][] = [];
  for (let frame = 0; frame < spec.frames; frame++) {
    frames.push(
      bodies.map((rigid) => {
        const p = rigid.translation();
        const q = rigid.rotation();
        return [p.x, p.y, p.z, q.x, q.y, q.z, q.w].map(clean);
      }),
    );
    world.step();
  }
  world.free();
  return { fps: spec.fps, bodies: spec.bodies.map((body) => body.name), frames };
}

const [specPath, outPath] = process.argv.slice(2);
if (specPath && outPath) {
  const spec = JSON.parse(readFileSync(specPath, "utf8")) as PhysicsSpec;
  writeFileSync(outPath, JSON.stringify(await bakePhysics(spec)));
  console.log(`Đã tính ${spec.frames} khung: ${outPath}`);
}
