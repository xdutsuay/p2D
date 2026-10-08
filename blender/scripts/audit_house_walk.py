"""
Read-only audit of a house_walk blend vs house_graph room ids.

Opens the blend, lists collections + room massing objects + photo custom props,
renders a top-down preview. Never saves the blend.

blender --background --python audit_house_walk.py -- <project_root> <blend_path>
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import bpy
import mathutils


def argv_after_dd():
    if "--" in sys.argv:
        return sys.argv[sys.argv.index("--") + 1 :]
    return []


def main():
    args = argv_after_dd()
    root = Path(args[0]) if args else Path(__file__).resolve().parents[2]
    blend = Path(args[1]) if len(args) > 1 else root / ".blenderassets" / "house_walk.blend"
    out_png = root / ".blenderassets" / "audit_house_walk_top.png"

    bpy.ops.wm.open_mainfile(filepath=str(blend))
    print(f"AUDIT blend={blend}")

    graph_path = root / "data" / "private" / "house_graph.json"
    graph_ids = set()
    if graph_path.exists():
        g = json.loads(graph_path.read_text(encoding="utf-8"))
        graph_ids = {r.get("id") for r in (g.get("rooms") or [])}
    print(f"GRAPH room ids ({len(graph_ids)}): {sorted(graph_ids)}")

    print("COLLECTIONS:")
    for c in bpy.data.collections:
        print(f"  {c.name} objects={len(c.objects)}")

    massing = []
    photos = 0
    photo_rooms = {}
    for obj in bpy.data.objects:
        if obj.name.startswith(("Floor_", "Wall_", "Label_")):
            massing.append(obj.name)
        if obj.get("p2d_id"):
            photos += 1
            rid = obj.get("p2d_room_id") or ""
            photo_rooms[rid] = photo_rooms.get(rid, 0) + 1
    print(f"MASSING objects: floors/walls/labels={len(massing)}")
    room_objs = sorted(
        {n.split("_", 1)[1] for n in massing if n.startswith(("Floor_", "Label_"))}
    )
    print(f"ROOM objects in blend ({len(room_objs)}): {room_objs}")
    missing = sorted(i for i in graph_ids if i and i not in room_objs)
    extra = sorted(i for i in room_objs if i not in graph_ids)
    print(f"GRAPH rooms missing from blend: {missing}")
    print(f"BLEND rooms not in graph: {extra}")
    print(f"PHOTO cards={photos} by p2d_room_id: {photo_rooms}")

    print("LABELS:")
    for obj in sorted(bpy.data.objects, key=lambda o: o.name):
        if obj.name.startswith("Label_"):
            print(f"  {obj.name} at ({obj.location.x:.2f},{obj.location.y:.2f},{obj.location.z:.2f})")

    # Top-down ortho render for visual audit (does not save the blend)
    scene = bpy.context.scene
    cam_data = bpy.data.cameras.new("AuditCam")
    cam_data.type = "ORTHO"
    cam = bpy.data.objects.new("AuditCam", cam_data)
    scene.collection.objects.link(cam)

    xs, ys = [], []
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        if not obj.name.startswith(("Floor_", "Wall_")):
            continue
        for corner in obj.bound_box:
            world = obj.matrix_world @ mathutils.Vector(corner)
            xs.append(world.x)
            ys.append(world.y)
    if xs and ys:
        cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
        span = max(max(xs) - min(xs), max(ys) - min(ys)) + 4
    else:
        cx, cy, span = 0, 0, 30
    cam_data.ortho_scale = span
    cam_data.clip_start = 0.1
    cam_data.clip_end = 1000.0
    cam.location = (cx, cy, max(40.0, span))
    cam.rotation_euler = (0, 0, 0)
    scene.camera = cam
    try:
        scene.render.engine = "BLENDER_WORKBENCH"
    except TypeError as e:
        print(f"engine set failed: {e}")
    shading = getattr(scene.display, "shading", None)
    if shading is not None:
        shading.light = "FLAT"
        shading.color_type = "RANDOM"
        shading.show_object_outline = True
        shading.show_shadows = False
    scene.render.film_transparent = False
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 1600
    scene.render.resolution_percentage = 100
    scene.render.filepath = str(out_png)
    # Hide roof slab so the plan is visible from above.
    for obj in bpy.data.objects:
        if obj.name.startswith("RoofSlab"):
            obj.hide_render = True
            obj.hide_set(True)
    bpy.ops.render.render(write_still=True)
    print(f"AUDIT_IMAGE {out_png}")


if __name__ == "__main__":
    main()
