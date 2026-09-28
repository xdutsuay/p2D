#!/usr/bin/env node
/**
 * Rewrite room rectangles from floor_map.png + photo stitch graph.
 *
 * Photo-stitch ground truth (auto-stitch-labels.mjs links):
 *   porch ↔ bedroom_3 (N/S)     porch ↔ bedroom_4 (E/W, beside)
 *   bedroom_3 ↔ hall_stairs     hall_a ↔ hall_stairs
 *   gallery ↔ bedroom_1         gallery ↔ bedroom_2
 *   bedroom_2 ↔ roof terrace (above)
 *
 * Right column is NOT porch→bed2→bed3→bed1→stairs (that was wrong).
 * bed1/bed2 live on the gallery wing; bed2 also sits SE under the porch on the map.
 *
 * Units: map feet → metres.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const graphPath = path.join(root, "data", "private", "house_graph.json");
const g = JSON.parse(fs.readFileSync(graphPath, "utf8"));

const FT = 0.3048;
const m = (ft) => Number((ft * FT).toFixed(2));

/** Room helper: x,y,w,d in feet (origin SW, +Y north / back of house) */
function R(id, name, kind, x, y, w, d, notes, h = 3) {
  return {
    id,
    name,
    kind,
    approx_l_m: m(w),
    approx_w_m: m(d),
    ceiling_h_m: kind === "porch" ? 2.6 : h,
    floor_z_m: 0,
    origin_x_m: m(x),
    origin_y_m: m(y),
    notes,
  };
}

/*
  Floor map (feet), origin SW — stitch-corrected:

  Left wing 0–16:
    bed5 (top, no photo), bed6, tall hall, SW bath + hall entry

  Main 16–46.9:
    TOP: bathroom | kitchen | utility
    RIGHT strip S→N: bed2 (SE) → porch → bedroom_3 → stairs → utility
    BOTTOM-CENTER: bedroom_4 (width ~21) — WEST of porch (stitch: porch right→bed4)
    CENTER: living; gallery + bedroom_1 west of right strip
*/

g.rooms = [
  // Left wing
  R("bath_no_photo", "Bath (no photo)", "bathroom", 0, 0, 8, 8, "Map: no photo for bathroom (SW)"),
  R("hall_sw", "Hall entry (SW leftover)", "open", 8, 0, 8, 8, "Fills left-wing gap east of bath"),
  R("hall_a", "Hall", "open", 0, 8, 16, 41, "Left wing hall (3923–3934). Stitch↔stairs. Tall open volume."),
  R("bedroom_6", "Bedroom 6 (no photo)", "room", 0, 41, 16, 8, "Map: no photo — left wing above hall"),
  R("bedroom_5", "Bedroom 5 (no photo)", "room", 0, 49, 16, 8, "Map: no photo — top-left"),

  // Street / SE — bed2 under porch on map; porch north of bed2
  R("bedroom_2", "Bedroom 2", "room", 37, 0, 9.9, 8, "SE corner under porch. Photos 3427+; terrace above (4104). Gallery-linked."),
  R("porch", "Porch (proche)", "porch", 37, 8, 9.9, 8, "North of bed2. Stitch: back→bed3, right→bed4."),

  // Bottom-center — bedroom_4 beside porch (21 ft)
  R("bedroom_4", "Bedroom 4", "room", 16, 0, 21, 16, "Width ~21. Photos 3213–3229. West of porch (not on right stack)."),

  // Right column above porch: bed3 then stairs (NO bed1 here)
  R("bedroom_3", "Bedroom 3", "room", 37, 16, 9.9, 16, "Photos 4332–4401. Between porch and stairs. Stitch↔porch, ↔stairs."),
  R("hall_stairs", "Stairs / stair hall", "corridor", 37, 32, 9.9, 17, "Photos 3952–4025. Stitch↔bed3, ↔hall_a, ↔roof."),

  // Top service row
  R("bathroom", "Bathroom", "bathroom", 16, 49, 10, 8, "Top row"),
  R("kitchen", "Kitchen", "kitchen", 26, 49, 11, 8, "Top row — mixed photos with utility OK"),
  R("utility", "Utility", "utility", 37, 49, 9.9, 8, "Top-right; above stairs"),

  // Gallery wing — bed1 off the right column (stitch: gallery→bed1, gallery→bed2)
  R("gallery", "Gallery", "corridor", 28, 16, 9, 16, "Links bedroom_1 and bedroom_2; west of bed3"),
  R("bedroom_1", "Bedroom 1", "room", 16, 16, 12, 16, "Gallery-connected photos 3309–3355. NOT between bed3 and stairs."),

  // Center living (remainder of main block)
  R("hall_main", "Main hall / living", "open", 16, 32, 21, 17, "Central living north of gallery/bed1; opens to left hall + stairs"),
];

g.structure.plot_footprint = {
  width_m: m(46.9),
  depth_m: m(57),
  origin_x_m: 0,
  origin_y_m: 0,
  map_height_units: 57,
  map_left_width_units: 16,
  map_right_top_width_units: 30.9,
  map_bedroom4_width_units: 21,
};

g.structure.slab.spans = g.rooms.map((r) => r.id);
g.structure.pillars = [
  { id: "p_porch_sw", x_m: m(38), y_m: m(9), width_m: 0.4, depth_m: 0.4, height_m: 2.6, load_bearing: true },
  { id: "p_porch_se", x_m: m(45), y_m: m(9), width_m: 0.4, depth_m: 0.4, height_m: 2.6, load_bearing: true },
  { id: "p_stairs", x_m: m(40), y_m: m(40), width_m: 0.35, depth_m: 0.35, height_m: 3, load_bearing: true },
  { id: "p_hall", x_m: m(26), y_m: m(38), width_m: 0.35, depth_m: 0.35, height_m: 3, load_bearing: true },
];

g.adjacencies = [
  // Photo stitches
  { from: "porch", to: "bedroom_3", shared_wall: "N", opening: "door", opening_width_m: 1.0 },
  { from: "porch", to: "bedroom_4", shared_wall: "W", opening: "door", opening_width_m: 1.0 },
  { from: "porch", to: "bedroom_2", shared_wall: "S", opening: "door", opening_width_m: 0.9 },
  { from: "bedroom_3", to: "hall_stairs", shared_wall: "N", opening: "door", opening_width_m: 1.0 },
  { from: "hall_a", to: "hall_stairs", shared_wall: "E", opening: "open", opening_width_m: 1.5 },
  { from: "gallery", to: "bedroom_1", shared_wall: "W", opening: "door", opening_width_m: 0.9 },
  { from: "gallery", to: "bedroom_2", shared_wall: "S", opening: "door", opening_width_m: 0.9 },
  // Map / circulation
  { from: "hall_stairs", to: "utility", shared_wall: "N", opening: "open", opening_width_m: 1.0 },
  { from: "bathroom", to: "kitchen", shared_wall: "E", opening: "door", opening_width_m: 0.75 },
  { from: "kitchen", to: "utility", shared_wall: "E", opening: "open", opening_width_m: 1.2 },
  { from: "bath_no_photo", to: "hall_sw", shared_wall: "E", opening: "open", opening_width_m: 1.5 },
  { from: "hall_sw", to: "hall_a", shared_wall: "N", opening: "open", opening_width_m: 1.5 },
  { from: "hall_a", to: "hall_main", shared_wall: "E", opening: "open", opening_width_m: 1.5 },
  { from: "hall_main", to: "bedroom_1", shared_wall: "S", opening: "open", opening_width_m: 1.2 },
  { from: "gallery", to: "bedroom_3", shared_wall: "E", opening: "door", opening_width_m: 0.9 },
  { from: "bedroom_5", to: "bedroom_6", shared_wall: "S", opening: null, opening_width_m: null },
  { from: "bedroom_6", to: "hall_a", shared_wall: "S", opening: "door", opening_width_m: 0.9 },
];

g.version = 8;
g.meta.notes =
  "v8 stitch-corrected: right strip bed2→porch→bed3→stairs (no bed1); bed4 west of porch (21ft); bed1 on gallery wing; left hall tall. Matches photo links porch↔bed3↔stairs, porch↔bed4, gallery↔bed1/bed2.";

fs.writeFileSync(graphPath, JSON.stringify(g, null, 2) + "\n");
console.log("Updated rooms:", g.rooms.map((r) => r.id).join(", "));
console.log("Plot m:", g.structure.plot_footprint.width_m, "x", g.structure.plot_footprint.depth_m);
