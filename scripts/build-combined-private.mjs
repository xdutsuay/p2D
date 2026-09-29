#!/usr/bin/env node
/**
 * Build a PRIVATE combined photo catalog from:
 *   - Set 1: phone stills `.tempphotos_donotsteal/20260925_*.jpg` (labeled ~70% earlier)
 *   - Set 2: AR capture snaps + optional fill from capture_20260929_120630
 *
 * Writes only under data/private/ (gitignored). Does not invent labels — seeds
 * empty notes/adjacents so you can comment per element in labeler/Blender.
 *
 * Usage:
 *   node scripts/build-combined-private.mjs
 *   node scripts/build-combined-private.mjs --with-fill
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = path.join(root, ".tempphotos_donotsteal");
const privateDir = path.join(root, "data", "private");
const photosDir = path.join(privateDir, "photos");
const catalogPath = path.join(privateDir, "photo_catalog.json");
const captureDir = path.join(temp, "capture_20260929_120630");

const withFill = process.argv.includes("--with-fill");

function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true });
}

function copyFile(src, dest) {
  fs.copyFileSync(src, dest);
}

function emptyAdjacents() {
  return {};
}

function photoStub({ id, filename, photo_code, taken_at, facing, location_type, notes, source, pose }) {
  return {
    id,
    filename,
    photo_code,
    taken_at: taken_at ?? null,
    facing: facing ?? null,
    location_type: location_type ?? null,
    room_id: null,
    shows: [],
    adjacents: emptyAdjacents(),
    notes: notes ?? "",
    quality: null,
    usable_for: ["massing", "texture"],
    scale_hints: [],
    // Private extension fields for Blender (ignored by older labeler if unknown)
    source,
    pose_m: pose ?? null,
  };
}

function main() {
  ensureDir(photosDir);
  const photos = [];
  let n = 0;

  // --- Set 1: high-res phone stills ---
  const set1 = fs
    .readdirSync(temp)
    .filter((f) => /^20260925_.*\.jpg$/i.test(f))
    .sort();
  for (const f of set1) {
    n += 1;
    const id = `S1-${String(n).padStart(3, "0")}`;
    const destName = `${id}.jpg`;
    copyFile(path.join(temp, f), path.join(photosDir, destName));
    // Filename encodes local time 20260925_HHMMSS
    const m = f.match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/);
    const taken = m
      ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`
      : null;
    photos.push(
      photoStub({
        id,
        filename: destName,
        photo_code: id,
        taken_at: taken,
        notes: "set1 phone still — re-check facing/room (prior labels ~70%)",
        source: "set1_phone",
      }),
    );
  }

  // --- Set 2: AR snaps ---
  const snapsJsonl = path.join(captureDir, "snaps.jsonl");
  const snapsDir = path.join(captureDir, "snaps");
  if (fs.existsSync(snapsJsonl)) {
    const lines = fs.readFileSync(snapsJsonl, "utf8").split(/\r?\n/).filter(Boolean);
    let i = 0;
    for (const line of lines) {
      const s = JSON.parse(line);
      i += 1;
      const id = `AR-${String(i).padStart(3, "0")}`;
      const srcImg = path.join(captureDir, s.image || `snaps/${s.id}.jpg`);
      const destName = `${id}.jpg`;
      if (fs.existsSync(srcImg)) {
        copyFile(srcImg, path.join(photosDir, destName));
      } else if (fs.existsSync(path.join(snapsDir, path.basename(srcImg)))) {
        copyFile(path.join(snapsDir, path.basename(srcImg)), path.join(photosDir, destName));
      }
      photos.push(
        photoStub({
          id,
          filename: destName,
          photo_code: id,
          taken_at: null,
          facing: s.facing ?? null,
          location_type: s.location_type ?? "interior",
          notes: `AR snap ${s.id} frame=${s.frame}`,
          source: "ar_snap",
          pose: s.pos_m
            ? { pos_m: s.pos_m, quat_xyzw: s.quat_xyzw, frame: s.frame, t_ns: s.t_ns }
            : null,
        }),
      );
    }
  }

  // --- Optional fill stills ---
  if (withFill) {
    const fillDir = path.join(captureDir, "fill_candidates");
    const candPath = path.join(fillDir, "candidates.json");
    if (fs.existsSync(candPath)) {
      const cand = JSON.parse(fs.readFileSync(candPath, "utf8"));
      let i = 0;
      for (const item of cand.items || []) {
        if (!item.ok) continue;
        i += 1;
        const id = `FL-${String(i).padStart(3, "0")}`;
        const src = path.join(fillDir, item.file);
        if (!fs.existsSync(src)) continue;
        const destName = `${id}.jpg`;
        copyFile(src, path.join(photosDir, destName));
        photos.push(
          photoStub({
            id,
            filename: destName,
            photo_code: id,
            facing: item.facing ?? null,
            notes: `fill from video t=${item.t_sec}s frame=${item.frame}`,
            source: "ar_fill",
            pose: item.pos_m ? { pos_m: item.pos_m, frame: item.frame } : null,
          }),
        );
      }
    }
  }

  const catalog = {
    version: 1,
    privacy: "PRIVATE — data/private is gitignored",
    created_at: new Date().toISOString(),
    sources: {
      set1_dir: ".tempphotos_donotsteal/20260925_*.jpg",
      ar_capture: "capture_20260929_120630",
      with_fill: withFill,
    },
    photos,
  };

  fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));
  const bySrc = {};
  for (const p of photos) {
    bySrc[p.source] = (bySrc[p.source] || 0) + 1;
  }
  console.log("Wrote", catalogPath);
  console.log("Photos:", photos.length, bySrc);
  console.log("Next: npm run labeler  OR  npm run blender:photos");
}

main();
