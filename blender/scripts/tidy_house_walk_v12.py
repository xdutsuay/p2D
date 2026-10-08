"""
Tidy house_walk_v12: merge the stray 'gallery_2_top' cell into the graph layout.

- Deletes massing objects named for gallery_2_top (floor/walls/label).
- Reassigns any photo p2d_room_id == 'gallery_2_top' by geometry (room_of).
Never touches house_walk.blend; edits the given blend in place (pass an out path to be safe).

blender --background --python tidy_house_walk_v12.py -- <root> <blend> [out_blend]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import bpy

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))
import fit_walk_to_house as fw  # noqa: E402


def argv_after_dd():
    if "--" in sys.argv:
        return sys.argv[sys.argv.index("--") + 1 :]
    return []


def main():
    args = argv_after_dd()
    root = Path(args[0]) if args else Path(__file__).resolve().parents[2]
    blend = Path(args[1]) if len(args) > 1 else root / ".blenderassets" / "house_walk_v12.blend"
    out = Path(args[2]) if len(args) > 2 else blend
    if not blend.is_absolute():
        blend = root / blend
    if not out.is_absolute():
        out = root / out

    bpy.ops.wm.open_mainfile(filepath=str(blend))
    print(f"TIDY blend={blend}")

    graph = json.loads((root / "data/private/house_graph.json").read_text(encoding="utf-8"))
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

    removed = 0
    for obj in list(bpy.data.objects):
        if "gallery_2_top" in obj.name:
            bpy.data.objects.remove(obj, do_unlink=True)
            removed += 1
    print(f"REMOVED gallery_2_top objects={removed}")

    reassigned = 0
    for obj in bpy.data.objects:
        if not obj.get("p2d_id"):
            continue
        rid = str(obj.get("p2d_room_id") or "")
        if rid not in valid_ids or rid == "gallery_2_top":
            new_rid = fw.room_of(rects, obj.location.x, obj.location.y) or ""
            if new_rid != rid:
                obj["p2d_room_id_prev"] = rid
                obj["p2d_room_id"] = new_rid
                reassigned += 1
    print(f"REASSIGNED cards={reassigned}")

    bpy.ops.wm.save_as_mainfile(filepath=str(out))
    print(f"SAVED {out}")


if __name__ == "__main__":
    main()
