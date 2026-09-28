#!/usr/bin/env node
/**
 * Ingest a p2D capture package.
 *
 * Primary: snaps.jsonl + snaps/*.jpg (intentional nodes for Blender/labeler)
 * Fill: video keyframes from poses.jsonl only if --fill-video or no snaps
 *
 * Usage:
 *   node scripts/ingest-capture.mjs <capture_dir>
 *     [--distance-m 0.75] [--turn-deg 25] [--replace] [--scale-seed]
 *     [--fill-video] [--max-jump-m 1.5]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const privateDir = path.join(root, "data", "private");
const photosDir = path.join(privateDir, "photos");
const catalogPath = path.join(privateDir, "photo_catalog.json");

const FACING_YAW = {
  N: 0,
  NE: 45,
  E: 90,
  SE: 135,
  S: 180,
  SW: 225,
  W: 270,
  NW: 315,
};

function parseArgs(argv) {
  const args = {
    captureDir: null,
    distanceM: 0.75,
    turnDeg: 25,
    replace: false,
    scaleSeed: false,
    fillVideo: false,
    maxJumpM: 1.5,
  };
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--distance-m") args.distanceM = Number(argv[++i]);
    else if (a === "--turn-deg") args.turnDeg = Number(argv[++i]);
    else if (a === "--max-jump-m") args.maxJumpM = Number(argv[++i]);
    else if (a === "--replace") args.replace = true;
    else if (a === "--scale-seed") args.scaleSeed = true;
    else if (a === "--fill-video") args.fillVideo = true;
    else if (a.startsWith("-")) {
      console.error(`Unknown flag: ${a}`);
      process.exit(1);
    } else pos.push(a);
  }
  args.captureDir = pos[0] ? path.resolve(pos[0]) : null;
  return args;
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  const samples = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    samples.push(JSON.parse(t));
  }
  return samples;
}

function dist3(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function yawFromQuat(q) {
  const [x, y, z, w] = q;
  const vx = 0,
    vy = 0,
    vz = -1;
  const ix = w * vx + y * vz - z * vy;
  const iy = w * vy + z * vx - x * vz;
  const iz = w * vz + x * vy - y * vx;
  const iw = -x * vx - y * vy - z * vz;
  const rx = ix * w + iw * -x + iy * -z - iz * -y;
  const rz = iz * w + iw * -z + ix * -y - iy * -x;
  return (Math.atan2(rx, -rz) * 180) / Math.PI;
}

function yawFromSample(s) {
  if (s.facing && FACING_YAW[s.facing] != null) return FACING_YAW[s.facing];
  return yawFromQuat(s.quat_xyzw);
}

function angleDeltaDeg(a, b) {
  return Math.abs(((((a - b) % 360) + 540) % 360) - 180);
}

/** Tracked poses with teleport jumps broken into segments. */
function cleanTracked(samples, maxJumpM) {
  const out = [];
  let prev = null;
  for (const s of samples) {
    if (s.tracking !== "TRACKING" || !Array.isArray(s.pos_m)) {
      prev = null;
      continue;
    }
    if (prev && dist3(prev.pos_m, s.pos_m) > maxJumpM) {
      prev = s;
      out.push(s);
      continue;
    }
    out.push(s);
    prev = s;
  }
  return out;
}

function selectKeyframes(tracked, distanceM, turnDeg) {
  if (!tracked.length) return [];
  const keys = [tracked[0]];
  let last = tracked[0];
  let lastYaw = yawFromSample(last);
  for (let i = 1; i < tracked.length; i++) {
    const s = tracked[i];
    const d = dist3(last.pos_m, s.pos_m);
    const yaw = yawFromSample(s);
    const turn = angleDeltaDeg(yaw, lastYaw);
    if (d >= distanceM || turn >= turnDeg) {
      keys.push(s);
      last = s;
      lastYaw = yaw;
    }
  }
  const lastSample = tracked[tracked.length - 1];
  if (keys[keys.length - 1].frame !== lastSample.frame) keys.push(lastSample);
  return keys;
}

function sessionSlug(captureDir, manifest) {
  const base = path.basename(captureDir);
  const m = base.match(/capture_(\d{8}_\d{6})/);
  if (m) return m[1];
  if (manifest?.started_at) {
    return manifest.started_at
      .replace(/[-:]/g, "")
      .replace(/\..*$/, "")
      .replace("T", "_")
      .slice(0, 15);
  }
  return "session";
}

function takenAt(manifest, sample) {
  const start = Date.parse(manifest?.started_at ?? "");
  if (Number.isNaN(start)) return manifest?.started_at ?? null;
  const ms = Math.round((sample.frame / 30) * 1000);
  return new Date(start + ms).toISOString();
}

function extractFrame(videoPath, timeSec, outJpeg) {
  const r = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-ss",
      String(Math.max(0, timeSec)),
      "-i",
      videoPath,
      "-frames:v",
      "1",
      "-q:v",
      "2",
      outJpeg,
    ],
    { encoding: "utf8" }
  );
  if (r.status !== 0) throw new Error(r.stderr?.slice(-400) || "ffmpeg failed");
}

function isCapPhoto(p) {
  return String(p.photo_code || "").startsWith("CAP-");
}

function copySnapImage(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.captureDir) {
    console.error(
      "Usage: node scripts/ingest-capture.mjs <capture_dir> [--fill-video] [--distance-m 0.75] [--turn-deg 25] [--max-jump-m 1.5] [--replace] [--scale-seed]"
    );
    process.exit(1);
  }

  // Resolve nested pull folders (adb pull sometimes nests)
  let captureDir = args.captureDir;
  const nested = path.join(captureDir, path.basename(captureDir));
  if (!fs.existsSync(path.join(captureDir, "manifest.json")) && fs.existsSync(path.join(nested, "manifest.json"))) {
    captureDir = nested;
  }

  const manifestPath = path.join(captureDir, "manifest.json");
  const posesPath = path.join(captureDir, "poses.jsonl");
  const snapsPath = path.join(captureDir, "snaps.jsonl");

  const manifest = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, "utf8").replace(/^\uFEFF/, ""))
    : {
        format: "p2d.capture",
        version: 1,
        started_at: new Date().toISOString(),
        video: "video.mp4",
        poses: "poses.jsonl",
        primary: "snaps",
      };

  const snaps = readJsonl(snapsPath);
  const poses = readJsonl(posesPath);
  const videoPath = path.join(captureDir, manifest.video || "video.mp4");
  const slug = sessionSlug(captureDir, manifest);
  const t0 = poses[0]?.t_ns ?? snaps[0]?.t_ns ?? 0;

  fs.mkdirSync(photosDir, { recursive: true });

  /** @type {Array<{kind:'snap'|'fill', sample:any, filename:string, code:string}>} */
  const nodes = [];

  // PRIMARY: snaps
  for (let i = 0; i < snaps.length; i++) {
    const s = snaps[i];
    const code = `CAP-${slug}-${String(i + 1).padStart(3, "0")}`;
    const filename = `${code}.jpg`;
    const src = path.join(captureDir, s.image || `snaps/${s.id}.jpg`);
    const dest = path.join(photosDir, filename);
    if (fs.existsSync(src)) {
      copySnapImage(src, dest);
    } else {
      console.warn(`Missing snap image: ${src}`);
    }
    nodes.push({ kind: "snap", sample: s, filename, code });
  }

  // FILL: video keyframes if requested or no snaps
  const needFill = args.fillVideo || snaps.length === 0;
  if (needFill) {
    const tracked = cleanTracked(poses, args.maxJumpM);
    const keys = selectKeyframes(tracked, args.distanceM, args.turnDeg);
    const startIdx = nodes.length;
    for (let i = 0; i < keys.length; i++) {
      const s = keys[i];
      const code = `CAP-${slug}-F${String(i + 1).padStart(3, "0")}`;
      const filename = `${code}.jpg`;
      const outJpeg = path.join(photosDir, filename);
      const timeSec = t0 ? (s.t_ns - t0) / 1e9 : s.frame / 30;
      if (fs.existsSync(videoPath)) {
        try {
          extractFrame(videoPath, timeSec, outJpeg);
        } catch (e) {
          console.warn(`Fill frame failed ${filename}: ${e.message}`);
        }
      }
      nodes.push({ kind: "fill", sample: s, filename, code });
    }
    console.log(
      `Fill video: ${keys.length} keyframes from ${tracked.length} clean TRACKING poses (raw ${poses.length})`
    );
    void startIdx;
  }

  if (!nodes.length) {
    console.error("No snaps and no fill keyframes — nothing to ingest.");
    process.exit(1);
  }

  const newPhotos = nodes.map((n, i) => {
    const s = n.sample;
    const discarded = s.tracking && s.tracking !== "TRACKING";
    const scale_hints = [];
    if (args.scaleSeed && i > 0) {
      const prev = nodes[i - 1].sample;
      if (prev.pos_m && s.pos_m) {
        const d = dist3(prev.pos_m, s.pos_m);
        if (d > 0.05 && d < args.maxJumpM) {
          scale_hints.push({
            px_a: { x: 0.1, y: 0.5 },
            px_b: { x: 0.9, y: 0.5 },
            length_m: Number(d.toFixed(3)),
            label: "pose_delta_seed",
          });
        }
      }
    }
    return {
      id: n.code.toLowerCase().replace(/[^a-z0-9_]+/g, "_"),
      filename: n.filename,
      photo_code: n.code,
      taken_at: takenAt(manifest, s),
      facing: s.facing ?? null,
      location_type: s.location_type ?? null,
      room_id: null,
      shows: [],
      adjacents: {},
      notes:
        n.kind === "snap"
          ? `ingest:snap ${s.id || ""} pos_m=[${(s.pos_m || []).map((x) => Number(x).toFixed(2)).join(",")}]`
          : `ingest:fill frame=${s.frame} pos_m=[${(s.pos_m || []).map((x) => Number(x).toFixed(2)).join(",")}]`,
      quality: discarded ? "poor" : "ok",
      usable_for: discarded ? ["discard"] : ["massing", "texture"],
      scale_hints,
    };
  });

  for (let i = 0; i < newPhotos.length; i++) {
    if (i > 0) {
      newPhotos[i].adjacents.back = { photo_id: newPhotos[i - 1].id, note: null };
    }
    if (i < newPhotos.length - 1) {
      newPhotos[i].adjacents.front = { photo_id: newPhotos[i + 1].id, note: null };
    }
  }

  const existing =
    !args.replace && fs.existsSync(catalogPath)
      ? JSON.parse(fs.readFileSync(catalogPath, "utf8"))
      : { version: 1, photos: [] };

  const byId = new Map((existing.photos || []).map((p) => [p.id, p]));
  let added = 0;
  let updated = 0;
  const mergedNew = newPhotos.map((p) => {
    const prev = byId.get(p.id);
    if (!prev) {
      added++;
      return p;
    }
    updated++;
    return {
      ...p,
      room_id: prev.room_id ?? p.room_id,
      shows: prev.shows?.length ? prev.shows : p.shows,
      location_type: prev.location_type ?? p.location_type,
      notes:
        prev.notes && !String(prev.notes).startsWith("ingest:")
          ? prev.notes
          : p.notes,
      scale_hints: prev.scale_hints?.length ? prev.scale_hints : p.scale_hints,
    };
  });

  let photos;
  if (args.replace) {
    photos = mergedNew;
  } else {
    const newIds = new Set(mergedNew.map((p) => p.id));
    photos = [
      ...(existing.photos || []).filter((p) => !newIds.has(p.id) && !isCapPhoto(p)),
      ...(existing.photos || []).filter(
        (p) => isCapPhoto(p) && !newIds.has(p.id) && !String(p.photo_code).includes(slug)
      ),
      ...mergedNew,
    ];
  }

  fs.writeFileSync(
    catalogPath,
    JSON.stringify({ version: 1, updated_at: new Date().toISOString(), photos }, null, 2) + "\n"
  );

  fs.writeFileSync(
    path.join(captureDir, "keyframes.json"),
    JSON.stringify(
      {
        primary: "snaps",
        snap_count: snaps.length,
        fill_count: nodes.filter((n) => n.kind === "fill").length,
        nodes: nodes.map((n, i) => ({
          index: i,
          kind: n.kind,
          photo_code: n.code,
          id: n.sample.id || null,
          frame: n.sample.frame,
          pos_m: n.sample.pos_m,
          facing: n.sample.facing,
          location_type: n.sample.location_type || null,
        })),
      },
      null,
      2
    ) + "\n"
  );

  console.log(
    `Ingested ${newPhotos.length} nodes (${snaps.length} snaps` +
      `${needFill ? ", video fill on" : ", video fill off"}) → ${catalogPath}`
  );
  console.log(`  added=${added} updated=${updated}`);
}

main();
