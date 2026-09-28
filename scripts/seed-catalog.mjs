#!/usr/bin/env node
/**
 * Seed photo_catalog.json from files in data/private/photos.
 * Preserves existing labels when filename already present.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const photosDir = path.join(root, "data", "private", "photos");
const catalogPath = path.join(root, "data", "private", "photo_catalog.json");

function takenAtFromName(name) {
  // 20260925_143101.jpg -> 2026-09-25T14:31:01
  const m = name.match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
}

function emptyRecord(filename, index) {
  const base = filename.replace(/\.[^.]+$/, "");
  return {
    id: `photo_${String(index + 1).padStart(3, "0")}`,
    filename,
    photo_code: `P${String(index + 1).padStart(3, "0")}`,
    taken_at: takenAtFromName(filename),
    facing: null,
    location_type: null,
    room_id: null,
    shows: [],
    adjacents: {},
    notes: "",
    quality: null,
    usable_for: [],
    scale_hints: [],
  };
}

const existing = fs.existsSync(catalogPath)
  ? JSON.parse(fs.readFileSync(catalogPath, "utf8"))
  : { version: 1, photos: [] };

const byName = new Map((existing.photos || []).map((p) => [p.filename, p]));

const files = fs
  .readdirSync(photosDir)
  .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
  .sort();

const photos = files.map((filename, i) => {
  const prev = byName.get(filename);
  if (prev) {
    return {
      ...emptyRecord(filename, i),
      ...prev,
      id: prev.id || emptyRecord(filename, i).id,
      filename,
      taken_at: prev.taken_at ?? emptyRecord(filename, i).taken_at,
    };
  }
  return emptyRecord(filename, i);
});

const catalog = {
  version: 1,
  updated_at: new Date().toISOString(),
  photos,
};

fs.mkdirSync(path.dirname(catalogPath), { recursive: true });
fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + "\n");
console.log(`Seeded ${photos.length} photos → ${catalogPath}`);
