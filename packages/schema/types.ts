/**
 * Shared TypeScript types for photo catalog + house graph.
 */

export type Facing =
  | "N"
  | "NE"
  | "E"
  | "SE"
  | "S"
  | "SW"
  | "W"
  | "NW"
  | "UP"
  | "DOWN"
  | "unknown";

export type LocationType = "exterior" | "interior" | "threshold";

export type ShowsTag =
  | "walls"
  | "doors"
  | "windows"
  | "pillars"
  | "slab"
  | "stairs"
  | "roof"
  | "gate"
  | "floor"
  | "ceiling";

export type UsableFor = "massing" | "detail" | "texture" | "discard";

export interface ScaleHint {
  px_a: { x: number; y: number };
  px_b: { x: number; y: number };
  length_m: number;
  label?: string;
}

/** Spatial neighbor relative to the camera / this photo (for stitching + 3D). */
export type AdjacentDir =
  | "left"
  | "right"
  | "top"
  | "bottom"
  | "front"
  | "back";

export const ADJACENT_DIRS: AdjacentDir[] = [
  "left",
  "right",
  "top",
  "bottom",
  "front",
  "back",
];

/** Link to another photo and/or a free-text place note. All fields optional. */
export interface AdjacentLink {
  /** Other photo id (preferred for stitching). */
  photo_id: string | null;
  /** Room id, place name, or short note when no photo (or extra context). */
  note: string | null;
}

export type AdjacentsMap = Partial<Record<AdjacentDir, AdjacentLink | null>>;

export interface PhotoRecord {
  id: string;
  filename: string;
  photo_code: string;
  taken_at: string | null;
  facing: Facing | null;
  location_type: LocationType | null;
  room_id: string | null;
  shows: ShowsTag[];
  /**
   * Neighbors in camera space. Not every direction needs a value —
   * leave unset/null when unknown or not applicable.
   */
  adjacents: AdjacentsMap;
  /** @deprecated use adjacents.left.note — kept for older catalog files */
  adjacent_left?: string | null;
  /** @deprecated use adjacents.right.note */
  adjacent_right?: string | null;
  /** @deprecated use adjacents.front.note (was ahead) */
  adjacent_ahead?: string | null;
  /** @deprecated use adjacents.back.note (was behind) */
  adjacent_behind?: string | null;
  notes: string;
  quality: "good" | "ok" | "poor" | null;
  usable_for: UsableFor[];
  scale_hints: ScaleHint[];
}

/** Normalize legacy flat adjacent_* fields into adjacents map. */
export function normalizeAdjacents(p: PhotoRecord): AdjacentsMap {
  const base: AdjacentsMap = { ...(p.adjacents || {}) };
  const ensure = (dir: AdjacentDir, note: string | null | undefined) => {
    if (!note) return;
    const cur = base[dir];
    if (cur?.photo_id || cur?.note) return;
    base[dir] = { photo_id: null, note };
  };
  ensure("left", p.adjacent_left);
  ensure("right", p.adjacent_right);
  ensure("front", p.adjacent_ahead);
  ensure("back", p.adjacent_behind);
  return base;
}

export interface PhotoCatalog {
  version: number;
  updated_at: string | null;
  photos: PhotoRecord[];
}

export type RoomKind =
  | "room"
  | "corridor"
  | "porch"
  | "bathroom"
  | "kitchen"
  | "open"
  | "exterior"
  | "utility";

export interface Room {
  id: string;
  name: string;
  kind: RoomKind;
  approx_l_m: number | null;
  approx_w_m: number | null;
  ceiling_h_m: number | null;
  floor_z_m?: number;
  origin_x_m?: number | null;
  origin_y_m?: number | null;
  notes?: string;
}

export interface Adjacency {
  from: string;
  to: string;
  shared_wall: "N" | "E" | "S" | "W" | null;
  opening: "door" | "window" | "arch" | "open" | "gate" | null;
  opening_width_m: number | null;
}

export interface Pillar {
  id: string;
  x_m: number;
  y_m: number;
  width_m?: number;
  depth_m?: number;
  height_m?: number;
  load_bearing?: boolean;
  notes?: string;
}

export interface WallSeg {
  id: string;
  x0_m: number;
  y0_m: number;
  x1_m: number;
  y1_m: number;
  thickness_m?: number;
  height_m?: number;
  room_ids?: string[];
}

export interface HouseGraph {
  version: number;
  meta: {
    name: string;
    storeys_existing: number;
    units: "m";
    scale_factor: number;
    notes?: string;
  };
  rooms: Room[];
  adjacencies: Adjacency[];
  structure: {
    plot_footprint: {
      width_m: number;
      depth_m: number;
      origin_x_m: number;
      origin_y_m: number;
    };
    slab: {
      thickness_m: number;
      height_m: number;
      spans: string[];
    };
    pillars: Pillar[];
    load_bearing_walls: WallSeg[];
    external_walls: WallSeg[];
  };
  extension?: {
    storey_height_m: number;
    options: Array<{
      id: string;
      name: string;
      walls?: WallSeg[];
      pillars?: Pillar[];
      notes?: string;
    }>;
  };
}

export const FACING_OPTIONS: Array<Facing | ""> = [
  "",
  "N",
  "NE",
  "E",
  "SE",
  "S",
  "SW",
  "W",
  "NW",
  "UP",
  "DOWN",
  "unknown",
];

export const SHOWS_OPTIONS: ShowsTag[] = [
  "walls",
  "doors",
  "windows",
  "pillars",
  "slab",
  "stairs",
  "roof",
  "gate",
  "floor",
  "ceiling",
];

export const USABLE_OPTIONS: UsableFor[] = [
  "massing",
  "detail",
  "texture",
  "discard",
];

/* -------------------------------------------------------------------------- */
/* ARCore capture package (video.mp4 + poses.jsonl + manifest.json)           */
/* -------------------------------------------------------------------------- */

/** One intentional still — PRIMARY Blender / labeler node. */
export interface CaptureSnap {
  id: string;
  t_ns: number;
  frame: number;
  pos_m: [number, number, number];
  quat_xyzw: [number, number, number, number];
  facing: Facing | null;
  tracking: string;
  /** Custom (not from ARCore): exterior | interior | threshold */
  location_type: LocationType | null;
  note?: string;
  /** Relative path e.g. snaps/snap_001.jpg */
  image: string;
  role: "node";
}

/** One line in poses.jsonl from the Android capture app. */
export interface CapturePoseSample {
  t_ns: number;
  frame: number;
  /** Camera position in ARCore world meters [x, y, z]. */
  pos_m: [number, number, number];
  /** Display-oriented camera rotation quaternion [x, y, z, w]. */
  quat_xyzw: [number, number, number, number];
  /** Compass / yaw bucket; null when unknown. */
  facing: Facing | null;
  tracking: "TRACKING" | "PAUSED" | "STOPPED" | string;
}

export interface CaptureManifestDevice {
  manufacturer: string;
  model: string;
  android_sdk: number;
}

export interface CaptureManifestCamera {
  image_width: number;
  image_height: number;
  fx: number;
  fy: number;
  cx: number;
  cy: number;
}

/** manifest.json written by the Android capture app. */
export interface CaptureManifest {
  format: "p2d.capture";
  version: number;
  units: "m";
  /** v2+: snaps are primary nodes; video+poses are fill. */
  primary?: "snaps" | "poses";
  started_at: string;
  ended_at: string;
  duration_ms: number;
  pose_count: number;
  snap_count?: number;
  video: string;
  poses: string;
  snaps?: string;
  snaps_dir?: string;
  device: CaptureManifestDevice;
  camera: CaptureManifestCamera;
  arcore: string;
  coord_system: string;
  notes?: string;
}

/**
 * How capture fields map into PhotoRecord (ingest fills these; rest stay for QA):
 *
 * | Capture                         | PhotoRecord                       |
 * | ------------------------------- | --------------------------------- |
 * | snap (PRIMARY) / keyframe fill  | filename / id                     |
 * | sample.facing                   | facing                            |
 * | snap.location_type              | location_type                     |
 * | sample.t_ns / started_at        | taken_at (ISO)                    |
 * | trajectory neighbors            | adjacents.{front,back}            |
 * | pose deltas                     | scale_hints (optional seed)       |
 * | tracking != TRACKING            | usable_for: ["discard"]           |
 * | (manual)                        | room_id, shows, notes             |
 */
export const CAPTURE_TO_PHOTO_RECORD = {
  facing: "facing",
  locationType: "location_type",
  timestamp: "taken_at",
  neighbors: "adjacents",
  badTracking: "usable_for:discard",
  primaryNodes: "snaps",
  fill: "video+poses",
  manualQa: ["room_id", "shows", "notes"],
} as const;