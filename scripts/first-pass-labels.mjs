#!/usr/bin/env node
/**
 * First labeling pass: rooms + structure + photo assignments by walkthrough time.
 * Re-runnable; merges onto existing catalog ids/filenames.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const privateDir = path.join(root, "data", "private");
const catalogPath = path.join(privateDir, "photo_catalog.json");
const graphPath = path.join(privateDir, "house_graph.json");

// Ensure catalog seeded
spawnSync(process.execPath, [path.join(root, "scripts", "seed-catalog.mjs")], {
  cwd: root,
  stdio: "inherit",
});

const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));

/** @param {string} name */
function timeKey(name) {
  const m = name.match(/_(\d{6})/);
  return m ? m[1] : "000000";
}

/**
 * Assign label fields from walkthrough clusters (Samsung timestamps).
 * @param {string} filename
 */
function noteAdj(front, back, left, right, top = null, bottom = null) {
  /** @type {Record<string, { photo_id: null, note: string }>} */
  const adjacents = {};
  if (left) adjacents.left = { photo_id: null, note: left };
  if (right) adjacents.right = { photo_id: null, note: right };
  if (top) adjacents.top = { photo_id: null, note: top };
  if (bottom) adjacents.bottom = { photo_id: null, note: bottom };
  if (front) adjacents.front = { photo_id: null, note: front };
  if (back) adjacents.back = { photo_id: null, note: back };
  return adjacents;
}

/**
 * @param {string} filename
 */
function infer(filename) {
  const t = timeKey(filename);
  const n = Number(t);

  // Porch / gate / driveway
  if (n >= 143101 && n <= 143244) {
    return {
      photo_code: code("PORCH", n),
      facing: n <= 143143 ? "S" : "E",
      location_type: n <= 143133 ? "exterior" : "threshold",
      room_id: "porch",
      shows: ["walls", "pillars", "ceiling", "floor", "gate", "slab"],
      adjacents: noteAdj(
        n <= 143143 ? "street" : "yard",
        "hall",
        "boundary_wall",
        "porch",
        "slab_soffit",
        "floor"
      ),
      quality: "good",
      usable_for: ["massing", "detail"],
      notes: "Covered driveway/porch; pink pillars; maroon gate area",
    };
  }

  // Bedroom A (bed + wardrobe cluster)
  if (n >= 143256 && n <= 143434) {
    return {
      photo_code: code("BEDA", n),
      facing: "N",
      location_type: "interior",
      room_id: "bedroom_a",
      shows: ["walls", "doors", "windows", "ceiling", "floor"],
      adjacents: noteAdj(
        "exterior_wall",
        "hall",
        "bedroom_a",
        "hall",
        "ceiling",
        "floor"
      ),
      quality: "good",
      usable_for: ["massing", "detail", "texture"],
      notes: "Bedroom A — bed, wardrobe, pink walls, ceiling fan",
    };
  }

  // Bedroom B / TV wall / shelf
  if (n >= 143441 && n <= 143556) {
    return {
      photo_code: code("BEDB", n),
      facing: "W",
      location_type: "interior",
      room_id: "bedroom_b",
      shows: ["walls", "doors", "windows", "ceiling", "floor"],
      adjacents: noteAdj(
        "hall",
        "exterior_wall",
        "bedroom_a",
        "utility",
        "ceiling",
        "floor"
      ),
      quality: "good",
      usable_for: ["massing", "detail"],
      notes: "Bedroom B — high concrete shelf, TV niche, doorway",
    };
  }

  // Utility / drying / multipurpose
  if (n >= 143600 && n <= 143720) {
    return {
      photo_code: code("UTIL", n),
      facing: "E",
      location_type: "interior",
      room_id: "utility",
      shows: ["walls", "doors", "ceiling", "floor", "windows"],
      adjacents: noteAdj(
        "bathroom",
        "hall",
        "bedroom_b",
        "porch",
        "ceiling",
        "floor"
      ),
      quality: "ok",
      usable_for: ["massing", "detail"],
      notes: "Utility/multipurpose — clothesline, trunk, wardrobe",
    };
  }

  // Bathroom
  if (n >= 143803 && n <= 143847) {
    return {
      photo_code: code("BATH", n),
      facing: "N",
      location_type: "interior",
      room_id: "bathroom",
      shows: ["walls", "doors", "windows", "floor", "ceiling"],
      adjacents: noteAdj(
        "exterior_wall",
        "utility",
        null,
        null,
        "ceiling",
        "floor"
      ),
      quality: "good",
      usable_for: ["massing", "detail", "texture"],
      notes: "Bathroom — tiled walls, WC, shower, barred window",
    };
  }

  // Hall / living connections
  if (n >= 143923 && n <= 144056) {
    return {
      photo_code: code("HALL", n),
      facing: "E",
      location_type: "interior",
      room_id: "hall",
      shows: ["walls", "doors", "ceiling", "floor"],
      adjacents: noteAdj(
        "bedroom_a",
        "utility",
        "bedroom_b",
        "porch",
        "ceiling",
        "floor"
      ),
      quality: "good",
      usable_for: ["massing", "detail"],
      notes: "Hall/living — doorway grill, links rooms",
    };
  }

  // Niche / detail corners
  if (n >= 144100 && n <= 144104) {
    return {
      photo_code: code("DET", n),
      facing: "W",
      location_type: "interior",
      room_id: "bedroom_b",
      shows: ["walls"],
      adjacents: {},
      quality: "ok",
      usable_for: ["detail", "texture"],
      notes: "Interior detail / niche shelf",
    };
  }

  // Roof terrace / slab — critical for extension
  if (n >= 144115 && n <= 144401) {
    const early = n <= 144220;
    return {
      photo_code: code("ROOF", n),
      facing: early ? "N" : "W",
      location_type: "exterior",
      room_id: "roof_terrace",
      shows: ["slab", "roof", "walls", "pillars", "floor"],
      adjacents: noteAdj(
        early ? "neighbor_school" : "trees",
        null,
        "party_wall_brick",
        "parapet",
        "sky",
        "slab_top"
      ),
      quality: "good",
      usable_for: ["massing", "detail"],
      notes:
        "Roof terrace / ground-floor slab top — beams, parapet, brick party wall; primary surface for first-floor extension",
    };
  }

  return {
    photo_code: code("MISC", n),
    facing: "unknown",
    location_type: null,
    room_id: null,
    shows: [],
    adjacents: {},
    quality: "ok",
    usable_for: ["detail"],
    notes: "Needs manual review",
  };
}

function code(prefix, n) {
  return `${prefix}-${String(n).slice(-4)}`;
}

let photos = catalog.photos.map((p) => {
  const inferred = infer(p.filename);
  const {
    adjacent_left: _l,
    adjacent_right: _r,
    adjacent_ahead: _a,
    adjacent_behind: _b,
    ...rest
  } = { ...p, ...inferred };
  return {
    ...rest,
    adjacents: inferred.adjacents || p.adjacents || {},
    scale_hints: p.scale_hints || [],
    id: p.id,
    filename: p.filename,
    taken_at: p.taken_at,
  };
});

// Suggest walkthrough neighbors: previous/next photo in same room → left/right for stitching.
// Only fill photo_id when that direction has no photo yet (notes can remain).
for (let i = 0; i < photos.length; i++) {
  const cur = photos[i];
  const prev = i > 0 ? photos[i - 1] : null;
  const next = i < photos.length - 1 ? photos[i + 1] : null;
  const adj = { ...(cur.adjacents || {}) };

  if (prev && prev.room_id && prev.room_id === cur.room_id) {
    const left = adj.left || { photo_id: null, note: null };
    if (!left.photo_id) {
      adj.left = { photo_id: prev.id, note: left.note ?? null };
    }
  }
  if (next && next.room_id && next.room_id === cur.room_id) {
    const right = adj.right || { photo_id: null, note: null };
    if (!right.photo_id) {
      adj.right = { photo_id: next.id, note: right.note ?? null };
    }
  }
  photos[i] = { ...cur, adjacents: adj };
}

const houseGraph = {
  version: 1,
  meta: {
    name: "House ground floor",
    storeys_existing: 1,
    units: "m",
    scale_factor: 1.0,
    notes:
      "Proportional layout from photo walkthrough. Origin SW corner of plot. Roof terrace = top of ground slab for extension.",
  },
  rooms: [
    {
      id: "porch",
      name: "Covered porch / driveway",
      kind: "porch",
      approx_l_m: 5.5,
      approx_w_m: 4.0,
      ceiling_h_m: 2.6,
      floor_z_m: 0,
      origin_x_m: 0,
      origin_y_m: 0,
      notes: "Pink pillars, concrete soffit, gate to street",
    },
    {
      id: "hall",
      name: "Hall / living",
      kind: "open",
      approx_l_m: 4.0,
      approx_w_m: 3.5,
      ceiling_h_m: 3.0,
      floor_z_m: 0,
      origin_x_m: 5.5,
      origin_y_m: 0,
      notes: "Links porch to bedrooms and utility",
    },
    {
      id: "bedroom_a",
      name: "Bedroom A",
      kind: "room",
      approx_l_m: 4.0,
      approx_w_m: 3.2,
      ceiling_h_m: 3.0,
      floor_z_m: 0,
      origin_x_m: 5.5,
      origin_y_m: 3.5,
      notes: "Bed, wardrobe, pink walls",
    },
    {
      id: "bedroom_b",
      name: "Bedroom B",
      kind: "room",
      approx_l_m: 4.0,
      approx_w_m: 3.5,
      ceiling_h_m: 3.0,
      floor_z_m: 0,
      origin_x_m: 9.5,
      origin_y_m: 0,
      notes: "High concrete shelf, TV, niche",
    },
    {
      id: "utility",
      name: "Utility / multipurpose",
      kind: "utility",
      approx_l_m: 3.5,
      approx_w_m: 3.0,
      ceiling_h_m: 3.0,
      floor_z_m: 0,
      origin_x_m: 9.5,
      origin_y_m: 3.5,
      notes: "Clothes drying, trunk, chairs",
    },
    {
      id: "bathroom",
      name: "Bathroom",
      kind: "bathroom",
      approx_l_m: 1.8,
      approx_w_m: 2.2,
      ceiling_h_m: 2.8,
      floor_z_m: 0,
      origin_x_m: 13.0,
      origin_y_m: 3.5,
      notes: "Tiled, WC, shower, barred window",
    },
    {
      id: "roof_terrace",
      name: "Roof terrace (slab top)",
      kind: "exterior",
      approx_l_m: 12,
      approx_w_m: 8,
      ceiling_h_m: 0,
      floor_z_m: 3.0,
      origin_x_m: 0,
      origin_y_m: 4,
      notes: "Flat slab for first-floor; brick party wall; parapet",
    },
  ],
  adjacencies: [
    { from: "porch", to: "hall", shared_wall: "E", opening: "door", opening_width_m: 1.0 },
    { from: "hall", to: "bedroom_a", shared_wall: "N", opening: "door", opening_width_m: 0.9 },
    { from: "hall", to: "bedroom_b", shared_wall: "E", opening: "door", opening_width_m: 0.9 },
    { from: "bedroom_b", to: "utility", shared_wall: "N", opening: "door", opening_width_m: 0.9 },
    { from: "utility", to: "bathroom", shared_wall: "E", opening: "door", opening_width_m: 0.75 },
  ],
  structure: {
    plot_footprint: {
      width_m: 15,
      depth_m: 12,
      origin_x_m: 0,
      origin_y_m: 0,
    },
    slab: {
      thickness_m: 0.15,
      height_m: 3.0,
      spans: ["porch", "hall", "bedroom_a", "bedroom_b", "utility", "bathroom"],
    },
    pillars: [
      {
        id: "p_porch_sw",
        x_m: 0.4,
        y_m: 0.4,
        width_m: 0.4,
        depth_m: 0.4,
        height_m: 2.6,
        load_bearing: true,
        notes: "Porch corner pillar (pink)",
      },
      {
        id: "p_porch_se",
        x_m: 5.1,
        y_m: 0.4,
        width_m: 0.4,
        depth_m: 0.4,
        height_m: 2.6,
        load_bearing: true,
        notes: "Porch street-side pillar",
      },
      {
        id: "p_porch_nw",
        x_m: 0.4,
        y_m: 3.6,
        width_m: 0.4,
        depth_m: 0.4,
        height_m: 2.6,
        load_bearing: true,
        notes: "Porch inner pillar",
      },
      {
        id: "p_porch_ne",
        x_m: 5.1,
        y_m: 3.6,
        width_m: 0.4,
        depth_m: 0.4,
        height_m: 2.6,
        load_bearing: true,
        notes: "Porch/hall transition pillar",
      },
      {
        id: "p_mid_1",
        x_m: 9.5,
        y_m: 3.5,
        width_m: 0.35,
        depth_m: 0.35,
        height_m: 3.0,
        load_bearing: true,
        notes: "Interior structural column near bedroom_b/utility",
      },
      {
        id: "p_mid_2",
        x_m: 13.0,
        y_m: 0.5,
        width_m: 0.35,
        depth_m: 0.35,
        height_m: 3.0,
        load_bearing: true,
        notes: "East edge column",
      },
    ],
    load_bearing_walls: [
      {
        id: "lb_party_brick",
        x0_m: 0,
        y0_m: 8,
        x1_m: 0,
        y1_m: 12,
        thickness_m: 0.35,
        height_m: 3.0,
        room_ids: ["roof_terrace"],
      },
      {
        id: "lb_hall_n",
        x0_m: 5.5,
        y0_m: 3.5,
        x1_m: 9.5,
        y1_m: 3.5,
        thickness_m: 0.23,
        height_m: 3.0,
        room_ids: ["hall", "bedroom_a"],
      },
    ],
    external_walls: [
      { id: "ext_s", x0_m: 0, y0_m: 0, x1_m: 15, y1_m: 0, thickness_m: 0.23, height_m: 3.0 },
      { id: "ext_e", x0_m: 15, y0_m: 0, x1_m: 15, y1_m: 12, thickness_m: 0.23, height_m: 3.0 },
      { id: "ext_n", x0_m: 15, y0_m: 12, x1_m: 0, y1_m: 12, thickness_m: 0.23, height_m: 3.0 },
      { id: "ext_w", x0_m: 0, y0_m: 12, x1_m: 0, y1_m: 0, thickness_m: 0.23, height_m: 3.0 },
    ],
  },
  extension: {
    storey_height_m: 3.0,
    options: [
      {
        id: "opt_a",
        name: "Full footprint over rooms (flush walls)",
        footprint_width_m: 15,
        footprint_depth_m: 8,
        footprint_origin_x_m: 0,
        footprint_origin_y_m: 4,
        notes: "Align first-floor walls to ground load-bearing walls and pillars; no cantilever.",
        walls: [
          { id: "ffa_s", x0_m: 0, y0_m: 4, x1_m: 15, y1_m: 4, thickness_m: 0.23, height_m: 3.0 },
          { id: "ffa_e", x0_m: 15, y0_m: 4, x1_m: 15, y1_m: 12, thickness_m: 0.23, height_m: 3.0 },
          { id: "ffa_n", x0_m: 15, y0_m: 12, x1_m: 0, y1_m: 12, thickness_m: 0.23, height_m: 3.0 },
          { id: "ffa_w", x0_m: 0, y0_m: 12, x1_m: 0, y1_m: 4, thickness_m: 0.23, height_m: 3.0 },
          { id: "ffa_part", x0_m: 7.5, y0_m: 4, x1_m: 7.5, y1_m: 12, thickness_m: 0.2, height_m: 3.0 },
        ],
        pillars: null,
      },
      {
        id: "opt_b",
        name: "Partial terrace keep + rooms over hall/bedrooms",
        footprint_width_m: 10,
        footprint_depth_m: 7,
        footprint_origin_x_m: 5,
        footprint_origin_y_m: 4,
        notes: "Leave porch roof as open terrace; build over hall/bedrooms only. Pillars land on ground pillars.",
        walls: [
          { id: "ffb_s", x0_m: 5, y0_m: 4, x1_m: 15, y1_m: 4, thickness_m: 0.23, height_m: 3.0 },
          { id: "ffb_e", x0_m: 15, y0_m: 4, x1_m: 15, y1_m: 11, thickness_m: 0.23, height_m: 3.0 },
          { id: "ffb_n", x0_m: 15, y0_m: 11, x1_m: 5, y1_m: 11, thickness_m: 0.23, height_m: 3.0 },
          { id: "ffb_w", x0_m: 5, y0_m: 11, x1_m: 5, y1_m: 4, thickness_m: 0.23, height_m: 3.0 },
        ],
        pillars: [
          { id: "ffb_p1", x_m: 5.1, y_m: 3.6, width_m: 0.4, depth_m: 0.4, height_m: 3.0 },
          { id: "ffb_p2", x_m: 9.5, y_m: 3.5, width_m: 0.35, depth_m: 0.35, height_m: 3.0 },
          { id: "ffb_p3", x_m: 13.0, y_m: 0.5, width_m: 0.35, depth_m: 0.35, height_m: 3.0 },
          { id: "ffb_p4", x_m: 13.0, y_m: 8.0, width_m: 0.35, depth_m: 0.35, height_m: 3.0 },
        ],
      },
    ],
  },
};

fs.writeFileSync(
  catalogPath,
  JSON.stringify(
    { version: 1, updated_at: new Date().toISOString(), photos },
    null,
    2
  ) + "\n"
);
fs.writeFileSync(graphPath, JSON.stringify(houseGraph, null, 2) + "\n");

const byRoom = photos.reduce((acc, p) => {
  const k = p.room_id || "unassigned";
  acc[k] = (acc[k] || 0) + 1;
  return acc;
}, {});

console.log("First-pass labels written.");
console.log("Photos by room:", byRoom);
console.log("Rooms:", houseGraph.rooms.length, "pillars:", houseGraph.structure.pillars.length);
