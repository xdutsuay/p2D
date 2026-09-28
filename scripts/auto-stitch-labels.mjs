#!/usr/bin/env node
/**
 * Floor-map + user cluster labels → catalog + house_graph + Blender-ready massing.
 * Usage: npm run label:auto
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const privateDir = path.join(root, "data", "private");
const catalogPath = path.join(privateDir, "photo_catalog.json");
const graphPath = path.join(privateDir, "house_graph.json");
const reviewPath = path.join(root, ".thinkhere", "label-review.html");

const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));

function suffix(filename) {
  const m = filename.match(/_(\d{6})/);
  return m ? m[1] : "";
}

/** Drawn map units treated as feet until confirmed. */
const MAP_FT_TO_M = 0.3048;
const mu = (u) => Number((u * MAP_FT_TO_M).toFixed(2));

/**
 * Explicit clusters from user + floor_map.png
 */
const SETS = {
  porch: {
    ids: ["143101", "143112", "143125", "143133", "143143", "143244"],
    room_id: "porch",
    facing: "S",
    location_type: "threshold",
    shows: ["walls", "pillars", "ceiling", "floor", "gate", "slab"],
    notes: "[auto] Porch (proche). Adjacent to bedroom_4.",
  },
  bedroom_4: {
    ids: ["143213", "143223", "143229"],
    room_id: "bedroom_4",
    facing: "E",
    location_type: "interior",
    shows: ["walls", "pillars", "ceiling", "floor", "doors"],
    notes: "[auto] Bedroom 4 — adjacent to porch. Right column above proche.",
  },
  gallery: {
    ids: ["143256", "143407", "143416", "143422"],
    room_id: "gallery",
    facing: "N",
    location_type: "interior",
    shows: ["walls", "doors", "ceiling", "floor"],
    notes: "[auto] Gallery + bedroom entrances (3256, 3407, 3416, 3422).",
  },
  bedroom_1: {
    ids: ["143309", "143331", "143338", "143347", "143355"],
    room_id: "bedroom_1",
    facing: "N",
    location_type: "interior",
    shows: ["walls", "doors", "windows", "ceiling", "floor"],
    notes: "[auto] Bedroom 1 via gallery.",
  },
  bedroom_2: {
    ids: ["143427", "143434", "143441", "143449", "143456", "144100", "144104"],
    room_id: "bedroom_2",
    facing: "W",
    location_type: "interior",
    shows: ["walls", "doors", "windows", "ceiling", "floor"],
    notes: "[auto] Bedroom 2. 4104 = from terrace above.",
  },
  utility: {
    ids: [
      "143540", "143547", "143556", "143600", "143609", "143616", "143625",
      "143633", "143642",
    ],
    room_id: "utility",
    facing: "E",
    location_type: "interior",
    shows: ["walls", "doors", "windows", "ceiling", "floor", "slab"],
    notes: "[auto] Utility. Kitchen edge left mixed for v1.",
  },
  kitchen: {
    ids: ["143648", "143654", "143656", "143703", "143708", "143712", "143720"],
    room_id: "kitchen",
    facing: "N",
    location_type: "interior",
    shows: ["walls", "doors", "windows", "ceiling", "floor"],
    notes: "[auto] Kitchen. Mixed edge with utility accepted for v1.",
  },
  bathroom: {
    ids: ["143803", "143831", "143834", "143840", "143847"],
    room_id: "bathroom",
    facing: "N",
    location_type: "interior",
    shows: ["walls", "doors", "windows", "floor", "ceiling"],
    notes: "[auto] Bathroom — top service row.",
  },
  hall_a: {
    ids: ["143923", "143934"],
    room_id: "hall_a",
    facing: "E",
    location_type: "interior",
    shows: ["walls", "doors", "ceiling", "floor"],
    notes: "[auto] Hall A (left wing).",
  },
  hall_stairs: {
    ids: ["143952", "143958", "144007", "144019", "144025"],
    room_id: "hall_stairs",
    facing: "UP",
    location_type: "interior",
    shows: ["walls", "doors", "stairs", "ceiling", "floor"],
    notes: "[auto] Hall + stairs (one place). Missing one stair photo.",
  },
  bedroom_3: {
    ids: ["144332", "144342", "144347", "144352", "144357", "144401"],
    room_id: "bedroom_3",
    facing: "W",
    location_type: "interior",
    shows: ["walls", "doors", "floor", "ceiling"],
    notes: "[auto] Bedroom 3 — between stairs and porch on right column.",
  },
  roof_terrace: {
    ids: [
      "144042", "144056", "144115", "144126", "144138", "144144", "144151",
      "144202", "144212", "144215", "144220", "144225", "144229", "144243",
      "144253", "144301", "144306",
    ],
    room_id: "roof_terrace",
    facing: "N",
    location_type: "exterior",
    shows: ["slab", "roof", "walls", "pillars", "floor"],
    notes: "[auto] Roof terrace / slab top.",
  },
};

const bySuffix = new Map();
for (const [setName, set] of Object.entries(SETS)) {
  for (const id of set.ids) bySuffix.set(id, { setName, ...set });
}
bySuffix.set("144104", {
  setName: "bedroom_2_from_terrace",
  room_id: "bedroom_2",
  facing: "DOWN",
  location_type: "exterior",
  shows: ["roof", "walls", "slab"],
  notes: "[auto] Top of bedroom_2 from terrace.",
  ids: ["144104"],
});

const CODE = {
  porch: "PORCH",
  gallery: "GAL",
  bedroom_1: "BED1",
  bedroom_2: "BED2",
  bedroom_3: "BED3",
  bedroom_4: "BED4",
  utility: "UTIL",
  kitchen: "KIT",
  bathroom: "BATH",
  hall_a: "HALLA",
  hall_stairs: "HSTAIR",
  roof_terrace: "ROOF",
};

function keepUserNotes(existing, autoNotes) {
  if (existing && String(existing).includes("[user]")) return existing;
  return autoNotes;
}

let photos = catalog.photos.map((p) => {
  const s = suffix(p.filename);
  const meta = bySuffix.get(s);
  if (!meta) {
    return {
      ...p,
      room_id: null,
      notes: keepUserNotes(p.notes, "[auto] Unclassified — assign manually."),
      adjacents: {},
      scale_hints: p.scale_hints || [],
      _s: s,
    };
  }
  return {
    ...p,
    photo_code: `${CODE[meta.room_id] || "P"}-${s.slice(-4)}`,
    room_id: meta.room_id,
    facing: meta.facing,
    location_type: meta.location_type,
    shows: meta.shows,
    quality: "good",
    usable_for: ["massing", "detail"],
    notes: keepUserNotes(p.notes, meta.notes),
    adjacents: {
      top: {
        photo_id: null,
        note: meta.location_type === "exterior" ? "sky" : "ceiling",
      },
      bottom: {
        photo_id: null,
        note: meta.room_id === "roof_terrace" ? "slab_top" : "floor",
      },
    },
    scale_hints: p.scale_hints || [],
    _s: s,
  };
});

photos.sort((a, b) => String(a._s).localeCompare(String(b._s)));

const byRoom = new Map();
photos.forEach((p, i) => {
  if (!p.room_id) return;
  if (!byRoom.has(p.room_id)) byRoom.set(p.room_id, []);
  byRoom.get(p.room_id).push(i);
});

for (const [, idxs] of byRoom) {
  for (let k = 0; k < idxs.length; k++) {
    const i = idxs[k];
    const adj = { ...(photos[i].adjacents || {}) };
    if (k > 0) {
      adj.left = {
        photo_id: photos[idxs[k - 1]].id,
        note: `prev_in_${photos[i].room_id}`,
      };
    }
    if (k < idxs.length - 1) {
      adj.right = {
        photo_id: photos[idxs[k + 1]].id,
        note: `next_in_${photos[i].room_id}`,
      };
    }
    photos[i] = { ...photos[i], adjacents: adj };
  }
}

function find(suf) {
  return photos.find((p) => p._s === suf);
}
function link(aSuf, dir, bSuf, note) {
  const a = find(aSuf);
  const b = find(bSuf);
  if (!a || !b) return;
  const i = photos.findIndex((p) => p.id === a.id);
  const adj = { ...(photos[i].adjacents || {}) };
  adj[dir] = { photo_id: b.id, note };
  photos[i] = { ...photos[i], adjacents: adj };
}

link("143256", "left", "143309", "bedroom_1");
link("143256", "right", "143416", "entrances");
link("143416", "front", "143309", "bedroom_1");
link("143422", "front", "143427", "bedroom_2");
link("143934", "front", "143952", "hall_stairs");
link("143952", "back", "143934", "hall_a");
link("144025", "front", "144042", "roof");
link("144042", "back", "144025", "stairs");
link("144332", "back", "143952", "hall_stairs");
link("143952", "right", "144332", "bedroom_3");
link("144401", "front", "143244", "porch");
link("143244", "back", "144401", "bedroom_3");
link("143213", "front", "143143", "porch");
link("143244", "right", "143213", "bedroom_4");
link("144104", "bottom", "143441", "bedroom_2_below");
link("143441", "top", "144104", "terrace_above");

photos = photos.map(({ _s, ...rest }) => rest);

const outCatalog = {
  version: 3,
  updated_at: new Date().toISOString(),
  source: "floor_map + bed3/bed4 corrections",
  photos,
};
fs.writeFileSync(catalogPath, JSON.stringify(outCatalog, null, 2) + "\n");

const graph = {
  version: 3,
  meta: {
    name: "House ground floor",
    storeys_existing: 1,
    units: "m",
    scale_factor: 1.0,
    map_unit_assumption: "feet",
    map_unit_to_m: MAP_FT_TO_M,
    notes:
      "From docs/floor_map.png. Outer depth 57; left wing 16; right/top 30.9; center notes 32.2/48.6/21. Feet→m assumed.",
    floor_map: "docs/floor_map.png",
  },
  rooms: [
    { id: "porch", name: "Porch (proche)", kind: "porch", approx_l_m: mu(12), approx_w_m: mu(10), ceiling_h_m: 2.6, floor_z_m: 0, origin_x_m: mu(34), origin_y_m: 0, notes: "Right column street side" },
    { id: "bedroom_4", name: "Bedroom 4", kind: "room", approx_l_m: mu(12), approx_w_m: mu(10), ceiling_h_m: 3, floor_z_m: 0, origin_x_m: mu(34), origin_y_m: mu(10), notes: "3213–3229; adjacent porch" },
    { id: "bedroom_3", name: "Bedroom 3", kind: "room", approx_l_m: mu(12), approx_w_m: mu(10), ceiling_h_m: 3, floor_z_m: 0, origin_x_m: mu(34), origin_y_m: mu(20), notes: "4332–4401; between stairs and porch" },
    { id: "hall_stairs", name: "Hall + stairs", kind: "corridor", approx_l_m: mu(10), approx_w_m: mu(8), ceiling_h_m: 3, floor_z_m: 0, origin_x_m: mu(34), origin_y_m: mu(30), notes: "3952–4025" },
    { id: "hall_a", name: "Hall A", kind: "open", approx_l_m: mu(16), approx_w_m: mu(20), ceiling_h_m: 3, floor_z_m: 0, origin_x_m: 0, origin_y_m: mu(16), notes: "3923–3934 left wing" },
    { id: "gallery", name: "Gallery", kind: "corridor", approx_l_m: mu(8), approx_w_m: mu(4), ceiling_h_m: 3, floor_z_m: 0, origin_x_m: mu(16), origin_y_m: mu(20), notes: "Links bed1/bed2" },
    { id: "bedroom_1", name: "Bedroom 1", kind: "room", approx_l_m: mu(14), approx_w_m: mu(12), ceiling_h_m: 3, floor_z_m: 0, origin_x_m: mu(16), origin_y_m: mu(8), notes: "" },
    { id: "bedroom_2", name: "Bedroom 2", kind: "room", approx_l_m: mu(14), approx_w_m: mu(12), ceiling_h_m: 3, floor_z_m: 0, origin_x_m: mu(34), origin_y_m: 0, notes: "Bottom-right; terrace view 4104" },
    { id: "bathroom", name: "Bathroom", kind: "bathroom", approx_l_m: mu(8), approx_w_m: mu(7), ceiling_h_m: 2.8, floor_z_m: 0, origin_x_m: mu(16), origin_y_m: mu(47), notes: "Top service row" },
    { id: "kitchen", name: "Kitchen", kind: "kitchen", approx_l_m: mu(10), approx_w_m: mu(8), ceiling_h_m: 2.8, floor_z_m: 0, origin_x_m: mu(24), origin_y_m: mu(47), notes: "" },
    { id: "utility", name: "Utility", kind: "utility", approx_l_m: mu(10), approx_w_m: mu(8), ceiling_h_m: 3, floor_z_m: 0, origin_x_m: mu(34), origin_y_m: mu(47), notes: "" },
    { id: "roof_terrace", name: "Roof terrace", kind: "exterior", approx_l_m: mu(30.9), approx_w_m: mu(40), ceiling_h_m: 0, floor_z_m: 3, origin_x_m: mu(16), origin_y_m: mu(10), notes: "First-floor canvas" },
  ],
  adjacencies: [
    { from: "porch", to: "bedroom_4", shared_wall: "N", opening: "door", opening_width_m: 0.9 },
    { from: "bedroom_4", to: "bedroom_3", shared_wall: "N", opening: "door", opening_width_m: 0.9 },
    { from: "bedroom_3", to: "hall_stairs", shared_wall: "N", opening: "door", opening_width_m: 0.9 },
    { from: "hall_stairs", to: "utility", shared_wall: "N", opening: "open", opening_width_m: 1.0 },
    { from: "hall_a", to: "hall_stairs", shared_wall: "E", opening: "open", opening_width_m: 1.2 },
    { from: "gallery", to: "bedroom_1", shared_wall: "S", opening: "door", opening_width_m: 0.9 },
    { from: "gallery", to: "bedroom_2", shared_wall: "N", opening: "door", opening_width_m: 0.9 },
    { from: "bathroom", to: "kitchen", shared_wall: "E", opening: "door", opening_width_m: 0.75 },
    { from: "kitchen", to: "utility", shared_wall: "E", opening: "open", opening_width_m: 1.2 },
    { from: "hall_stairs", to: "roof_terrace", shared_wall: "N", opening: "door", opening_width_m: 0.9 },
  ],
  structure: {
    plot_footprint: {
      width_m: mu(16 + 30.9),
      depth_m: mu(57),
      origin_x_m: 0,
      origin_y_m: 0,
      map_height_units: 57,
      map_left_width_units: 16,
      map_right_top_width_units: 30.9,
    },
    slab: {
      thickness_m: 0.15,
      height_m: 3.0,
      spans: [
        "porch", "bedroom_4", "bedroom_3", "hall_stairs", "hall_a", "gallery",
        "bedroom_1", "bedroom_2", "bathroom", "kitchen", "utility",
      ],
    },
    pillars: [
      { id: "p_porch_1", x_m: mu(36), y_m: mu(1), width_m: 0.4, depth_m: 0.4, height_m: 2.6, load_bearing: true },
      { id: "p_porch_2", x_m: mu(44), y_m: mu(1), width_m: 0.4, depth_m: 0.4, height_m: 2.6, load_bearing: true },
      { id: "p_stairs_1", x_m: mu(38), y_m: mu(32), width_m: 0.35, depth_m: 0.35, height_m: 3, load_bearing: true },
      { id: "p_mid_1", x_m: mu(26), y_m: mu(25), width_m: 0.35, depth_m: 0.35, height_m: 3, load_bearing: true },
    ],
    load_bearing_walls: [
      { id: "lb_party", x0_m: 0, y0_m: mu(40), x1_m: 0, y1_m: mu(57), thickness_m: 0.35, height_m: 3, room_ids: ["hall_a"] },
    ],
    external_walls: [
      { id: "ext_s", x0_m: 0, y0_m: 0, x1_m: mu(46.9), y1_m: 0, thickness_m: 0.23, height_m: 3 },
      { id: "ext_e", x0_m: mu(46.9), y0_m: 0, x1_m: mu(46.9), y1_m: mu(57), thickness_m: 0.23, height_m: 3 },
      { id: "ext_n", x0_m: mu(46.9), y0_m: mu(57), x1_m: 0, y1_m: mu(57), thickness_m: 0.23, height_m: 3 },
      { id: "ext_w", x0_m: 0, y0_m: mu(57), x1_m: 0, y1_m: 0, thickness_m: 0.23, height_m: 3 },
    ],
  },
  extension: {
    storey_height_m: 3.0,
    options: [
      {
        id: "opt_a",
        name: "Main block flush (lighter on porch)",
        footprint_width_m: mu(30.9),
        footprint_depth_m: mu(40),
        footprint_origin_x_m: mu(16),
        footprint_origin_y_m: mu(10),
        notes: "Land on hall_stairs + bedroom columns.",
        walls: [
          { id: "ffa_s", x0_m: mu(16), y0_m: mu(10), x1_m: mu(46.9), y1_m: mu(10), thickness_m: 0.23, height_m: 3 },
          { id: "ffa_e", x0_m: mu(46.9), y0_m: mu(10), x1_m: mu(46.9), y1_m: mu(50), thickness_m: 0.23, height_m: 3 },
          { id: "ffa_n", x0_m: mu(46.9), y0_m: mu(50), x1_m: mu(16), y1_m: mu(50), thickness_m: 0.23, height_m: 3 },
          { id: "ffa_w", x0_m: mu(16), y0_m: mu(50), x1_m: mu(16), y1_m: mu(10), thickness_m: 0.23, height_m: 3 },
        ],
        pillars: null,
      },
      {
        id: "opt_b",
        name: "Right column only (bed3/4 + stairs)",
        footprint_width_m: mu(14),
        footprint_depth_m: mu(28),
        footprint_origin_x_m: mu(32),
        footprint_origin_y_m: mu(10),
        notes: "Open terrace over left hall.",
        walls: [
          { id: "ffb_s", x0_m: mu(32), y0_m: mu(10), x1_m: mu(46), y1_m: mu(10), thickness_m: 0.23, height_m: 3 },
          { id: "ffb_e", x0_m: mu(46), y0_m: mu(10), x1_m: mu(46), y1_m: mu(38), thickness_m: 0.23, height_m: 3 },
          { id: "ffb_n", x0_m: mu(46), y0_m: mu(38), x1_m: mu(32), y1_m: mu(38), thickness_m: 0.23, height_m: 3 },
          { id: "ffb_w", x0_m: mu(32), y0_m: mu(38), x1_m: mu(32), y1_m: mu(10), thickness_m: 0.23, height_m: 3 },
        ],
        pillars: [
          { id: "ffb_p1", x_m: mu(34), y_m: mu(12), width_m: 0.35, depth_m: 0.35, height_m: 3 },
          { id: "ffb_p2", x_m: mu(40), y_m: mu(25), width_m: 0.35, depth_m: 0.35, height_m: 3 },
        ],
      },
    ],
  },
};

fs.writeFileSync(graphPath, JSON.stringify(graph, null, 2) + "\n");

const clusterMap = new Map();
for (const p of photos) {
  const k = p.room_id || "unassigned";
  if (!clusterMap.has(k)) clusterMap.set(k, []);
  clusterMap.get(k).push(p);
}

const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><title>p2D label review</title>
<style>body{font-family:system-ui;background:#1a211c;color:#e8efe6;margin:0;padding:1rem}
h1{color:#c4a35a}h2{border-bottom:1px solid #3d4a40;font-size:1rem}.meta{color:#9aab9e}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:.5rem}
.card{background:#242c26;border:1px solid #3d4a40;border-radius:6px;overflow:hidden;font-size:.7rem}
.card img{width:100%;height:96px;object-fit:cover;display:block}.code{color:#c4a35a;font-family:monospace}
img.map{max-width:min(640px,100%);border:1px solid #3d4a40;border-radius:6px}</style></head><body>
<h1>Labels v3</h1>
<p class="meta">${outCatalog.updated_at}</p>
<img class="map" src="../docs/floor_map.png" alt="floor map"/>
${[...clusterMap.entries()].map(([room, items]) =>
  `<h2>${room} (${items.length})</h2><div class="grid">${items.map((p) =>
    `<div class="card"><img src="../data/private/photos/${p.filename}" alt=""/><div style="padding:.35rem"><div class="code">${p.photo_code}</div></div></div>`
  ).join("")}</div>`
).join("")}
</body></html>`;
fs.mkdirSync(path.dirname(reviewPath), { recursive: true });
fs.writeFileSync(reviewPath, html);

const summary = Object.fromEntries([...clusterMap.entries()].map(([k, v]) => [k, v.length]));
console.log("Relabel v3 complete. By room:", summary);
const un = photos.filter((p) => !p.room_id).map((p) => p.filename);
if (un.length) console.log("Unassigned:", un);
console.log("Plot ~", graph.structure.plot_footprint.width_m, "x", graph.structure.plot_footprint.depth_m, "m (if map units are feet)");
