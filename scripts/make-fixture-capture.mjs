import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "data", "fixtures", "capture_20260101_120000");
fs.mkdirSync(dir, { recursive: true });

const t0 = 1_000_000_000_000;
const lines = [];
for (let i = 0; i < 120; i++) {
  let z = Math.min(4, i * 0.05);
  let x = 0;
  let facing = "N";
  let qy = 0;
  let qw = 1;
  if (i >= 80) {
    z = 4;
    x = (i - 80) * 0.075;
    facing = "E";
    qy = 0.7071068;
    qw = 0.7071068;
  }
  const t = t0 + i * 33_333_333;
  lines.push(
    JSON.stringify({
      t_ns: t,
      frame: i,
      pos_m: [Number(x.toFixed(6)), 1.5, Number(z.toFixed(6))],
      quat_xyzw: [0, qy, 0, qw],
      facing,
      tracking: "TRACKING",
    })
  );
}
fs.writeFileSync(path.join(dir, "poses.jsonl"), lines.join("\n") + "\n");

const manifest = {
  format: "p2d.capture",
  version: 1,
  units: "m",
  started_at: "2026-01-01T12:00:00.000Z",
  ended_at: "2026-01-01T12:00:04.000Z",
  duration_ms: 4000,
  pose_count: 120,
  video: "video.mp4",
  poses: "poses.jsonl",
  device: { manufacturer: "fixture", model: "Synthetic", android_sdk: 34 },
  camera: {
    image_width: 640,
    image_height: 480,
    fx: 500,
    fy: 500,
    cx: 320,
    cy: 240,
  },
  arcore: "fixture",
  coord_system: "arcore_display_oriented",
  notes: "Synthetic capture for ingest tests.",
};
fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log("Wrote fixture to", dir);
