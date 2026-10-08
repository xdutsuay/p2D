"""
ADD a new AR capture onto the existing (restored) house_walk plan, non-destructively.

Opens .blenderassets/house_walk.blend, keeps ALL existing collections/cards,
adds:
  - 20_Capture_<slug>        : photo cards for the new capture, placed in rooms
  - 21_Corners90_<slug>      : 90-degree pair hints for the new cards
  - 22_Unplaced_<slug>       : new snaps that fall outside the ground-floor plan
Also:
  - reassigns stale p2d_room_id values (rooms removed from house_graph) by geometry

Saves to a NEW file (house_walk_v12.blend by default). Never overwrites house_walk.blend.

blender --background --python add_capture_to_house_walk.py -- <root> [capture_dir] [out_blend]
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import bpy
import mathutils

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))
import fit_walk_to_house as fw  # noqa: E402


def argv_after_dd():
    if "--" in sys.argv:
        return sys.argv[sys.argv.index("--") + 1 :]
    return []


def load_jsonl(path: Path):
    return fw.load_jsonl(path)


def main():
    args = argv_after_dd()
    root = Path(args[0]) if args else Path(__file__).resolve().parents[2]
    capture = fw.resolve_capture(root, args[1] if len(args) > 1 else None)
    out_blend = (
        Path(args[2])
        if len(args) > 2
        else root / ".blenderassets" / "house_walk_v12.blend"
    )
    if not out_blend.is_absolute():
        out_blend = root / out_blend
    slug = capture.name.replace("capture_", "")

    house_blend = root / ".blenderassets" / "house_walk.blend"
    graph_path = root / "data" / "private" / "house_graph.json"
    catalog_path = root / "data" / "private" / "photo_catalog.json"
    photos_dir = root / "data" / "private" / "photos"

    if not house_blend.exists():
        raise SystemExit(f"Missing {house_blend}")
    if out_blend.resolve() == house_blend.resolve():
        raise SystemExit("Refusing to overwrite house_walk.blend — choose a new out name")

    print(f"ADD capture={capture}")
    print(f"ADD out={out_blend}")
    bpy.ops.wm.open_mainfile(filepath=str(house_blend))

    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    scale_h = float((graph.get("meta") or {}).get("scale_factor") or 1.0)
    valid_ids = {r.get("id") for r in (graph.get("rooms") or []) if r.get("id")}
    rects = []
    for room in graph.get("rooms") or []:
        if room.get("id") == "roof_terrace":
            continue
        x0 = float(room.get("origin_x_m") or 0) * scale_h
        y0 = float(room.get("origin_y_m") or 0) * scale_h
        x1 = x0 + float(room.get("approx_l_m") or 3) * scale_h
        y1 = y0 + float(room.get("approx_w_m") or 3) * scale_h
        rects.append((room, x0, y0, x1, y1))
    hx0 = min(r[1] for r in rects)
    hy0 = min(r[2] for r in rects)
    hx1 = max(r[3] for r in rects)
    hy1 = max(r[4] for r in rects)
    print(f"PLAN x=[{hx0:.2f},{hx1:.2f}] y=[{hy0:.2f},{hy1:.2f}] rooms={len(rects)}")

    # --- Fix stale p2d_room_id on existing cards (e.g. removed 'utility') ---
    fixed = 0
    for obj in bpy.data.objects:
        if not obj.get("p2d_id"):
            continue
        rid = str(obj.get("p2d_room_id") or "")
        if rid and rid not in valid_ids:
            new_rid = fw.room_of(rects, obj.location.x, obj.location.y) or ""
            obj["p2d_room_id_prev"] = rid
            obj["p2d_room_id"] = new_rid
            fixed += 1
    print(f"FIXED stale room_id cards={fixed}")

    # --- Fit the new capture's dense TRACKING core onto the plan ---
    poses = load_jsonl(capture / "poses.jsonl")
    core, (mx, my) = fw.core_points(poses, radius=8.0)
    print(f"POSE core={len(core)} (raw {len(poses)})")
    if len(core) < 20:
        raise SystemExit("Too few stable TRACKING poses to fit")
    fit = fw.search_fit(core, hx0, hx1, hy0, hy1)
    print(
        "FIT deg={deg} mirror={mirror} scale={scale:.3f} tx={tx:.2f} ty={ty:.2f} "
        "inside={inside:.2%} cells={cells}".format(**fit)
    )
    theta = math.radians(fit["deg"])

    # --- Join capture snaps to catalog photos (pose_m + assist) ---
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    by_code = {}
    for p in catalog.get("photos") or []:
        code = str(p.get("photo_code") or "")
        if code:
            by_code[code] = p
    snaps = load_jsonl(capture / "snaps.jsonl")
    prefix = f"CAP-{slug}-"

    col_photos = fw.ensure_collection(f"20_Capture_{slug}")
    col_corners = fw.ensure_collection(f"21_Corners90_{slug}")
    col_unplaced = fw.ensure_collection(f"22_Unplaced_{slug}")

    placed = []
    unplaced = 0
    assigned = {}
    for i, s in enumerate(snaps):
        sid = s.get("id") or f"snap_{i + 1:03d}"
        code = f"{prefix}{i + 1:03d}"
        photo = by_code.get(code) or {}
        pose = photo.get("pose_m") or {}
        pos = pose.get("pos_m") or s.get("pos_m")
        if not pos:
            continue
        px, pz = float(pos[0]), float(pos[2])
        if abs(px) > 40 or abs(pz) > 40:
            unplaced += 1
            continue
        X, Y = fw.apply_xy(
            px, pz, fit["mirror"], theta, fit["scale"], fit["tx"], fit["ty"]
        )
        img = photos_dir / (photo.get("filename") or f"{code}.jpg")
        inside = hx0 - 1.5 <= X <= hx1 + 1.5 and hy0 - 1.5 <= Y <= hy1 + 1.5
        facing = photo.get("facing") or s.get("facing") or "N"
        yaw = fw.FACING_YAW.get(facing, 0)
        fx = math.sin(math.radians(yaw))
        fy = -math.cos(math.radians(yaw))
        Fx, Fy = fw.apply_xy(fx, fy, fit["mirror"], theta, 1.0, 0, 0)
        forward = mathutils.Vector((Fx, Fy, 0))
        if forward.length < 1e-6:
            forward = mathutils.Vector((0, 1, 0))
        forward.normalize()
        card_yaw = math.atan2(forward.x, -forward.y)

        col = col_photos if inside else col_unplaced
        if not inside:
            unplaced += 1
            # Lay unplaced cards in a side row so they are still reviewable.
            obj = fw.image_plane(code, img, col, width=1.1)
            obj.location = mathutils.Vector((hx1 + 4.0 + (unplaced % 8) * 1.4, hy0 - 2.0 - (unplaced // 8) * 1.2, 1.2))
            obj.rotation_euler = (math.pi / 2, 0, 0)
        else:
            obj = fw.image_plane(code, img, col, width=1.15)
            obj.location = mathutils.Vector((X, Y, 1.35)) + forward * 0.45
            obj.rotation_euler = (math.pi / 2, 0, card_yaw)
        fw.add_label(code, obj.location + mathutils.Vector((0, 0, 0.85)), col, size=0.16)

        room = fw.room_of(rects, X, Y) if inside else ""
        assist = photo.get("assist") or {}
        obj["p2d_id"] = code
        obj["p2d_comment"] = ""
        obj["p2d_90_with"] = ""
        obj["p2d_facing"] = facing
        obj["p2d_source"] = "ar_snap_20261008"
        obj["p2d_room_id"] = room
        obj["p2d_yaw"] = math.degrees(card_yaw)
        obj["p2d_snap_id"] = sid
        obj["p2d_assist_room"] = assist.get("room_guess") or ""
        obj["p2d_assist_shows"] = assist.get("shows") or ""
        obj["p2d_assist_tip"] = assist.get("tip") or ""
        if inside:
            placed.append(obj)
            assigned[room] = assigned.get(room, 0) + 1

    # --- 90-degree pair hints among the new placed cards ---
    corners = 0
    for i, a in enumerate(placed):
        best = None
        best_d = 3.0
        ay = float(a.get("p2d_yaw", 0))
        for b in placed[i + 1 :]:
            d = abs(ay - float(b.get("p2d_yaw", 0))) % 360
            if d > 180:
                d = 360 - d
            if d < 70 or d > 110:
                continue
            dist = (a.location - b.location).length
            if dist < best_d:
                best, best_d = b, dist
        if best is None:
            continue
        a["p2d_90_with"] = best.name
        prev = str(best.get("p2d_90_with") or "")
        best["p2d_90_with"] = a.name if not prev else prev
        mesh = bpy.data.meshes.new(f"C90_{slug}_{corners}")
        mesh.from_pydata(
            [(a.location.x, a.location.y, 0.28), (best.location.x, best.location.y, 0.28)],
            [(0, 1)],
            [],
        )
        mesh.update()
        link = bpy.data.objects.new(f"90_{slug}_{a.name}_{best.name}", mesh)
        col_corners.objects.link(link)
        corners += 1

    print(f"PLACED={len(placed)} UNPLACED={unplaced} CORNERS={corners}")
    print(f"ROOMS={json.dumps(assigned, sort_keys=True)}")

    out_blend.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(out_blend))
    print(f"SAVED {out_blend}")


if __name__ == "__main__":
    main()
