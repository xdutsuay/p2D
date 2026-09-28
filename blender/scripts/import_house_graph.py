"""
Build a readable ground-floor massing from house_graph room rectangles.
Walls are extruded; each room gets a colored floor. Roof terrace is not a
solid lid (that was hiding the plan).

blender --background --python import_house_graph.py -- <project_root>
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import bpy


def argv_after_dd():
    if "--" in sys.argv:
        return sys.argv[sys.argv.index("--") + 1 :]
    return []


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for coll in list(bpy.data.collections):
        bpy.data.collections.remove(coll)
    for block in list(bpy.data.meshes):
        if block.users == 0:
            bpy.data.meshes.remove(block)
    for block in list(bpy.data.materials):
        if block.users == 0:
            bpy.data.materials.remove(block)


def ensure_collection(name: str):
    col = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(col)
    return col


def link(obj, col):
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    col.objects.link(obj)


def mat(name: str, rgb, alpha=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
        if "Alpha" in bsdf.inputs:
            bsdf.inputs["Alpha"].default_value = alpha
        if alpha < 1:
            m.blend_method = "BLEND"
    return m


def box(name, sx, sy, sz, loc, collection, material):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (max(sx, 0.02), max(sy, 0.02), max(sz, 0.02))
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if material:
        obj.data.materials.append(material)
    link(obj, collection)
    return obj


KIND_COLOR = {
    "porch": (0.72, 0.55, 0.38),
    "room": (0.62, 0.58, 0.52),
    "bathroom": (0.45, 0.62, 0.72),
    "kitchen": (0.75, 0.62, 0.4),
    "utility": (0.55, 0.58, 0.48),
    "corridor": (0.5, 0.52, 0.55),
    "open": (0.58, 0.6, 0.52),
    "exterior": (0.4, 0.42, 0.38),
}


def room_rect(room, scale):
    """Return (x0, y0, x1, y1) in metres. approx_l = X, approx_w = Y."""
    x0 = float(room.get("origin_x_m") or 0) * scale
    y0 = float(room.get("origin_y_m") or 0) * scale
    dx = float(room.get("approx_l_m") or 3) * scale
    dy = float(room.get("approx_w_m") or 3) * scale
    return x0, y0, x0 + dx, y0 + dy


def add_label(name, x, y, z, collection):
    curve = bpy.data.curves.new(name, type="FONT")
    curve.body = name.replace("_", " ")
    curve.size = 0.35
    curve.align_x = "CENTER"
    curve.align_y = "CENTER"
    obj = bpy.data.objects.new(name, curve)
    obj.location = (x, y, z)
    obj.rotation_euler = (0, 0, 0)
    collection.objects.link(obj)
    return obj


def main():
    args = argv_after_dd()
    root = Path(args[0]) if args else Path(__file__).resolve().parents[2]
    graph_path = root / "data" / "private" / "house_graph.json"
    out_blend = root / ".blenderassets" / "house_ground.blend"
    data = json.loads(graph_path.read_text(encoding="utf-8"))
    scale = float((data.get("meta") or {}).get("scale_factor") or 1.0)

    clear_scene()
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0

    col_ground = ensure_collection("01_Ground")
    col_floors = ensure_collection("02_RoomFloors")
    col_walls = ensure_collection("03_Walls")
    col_labels = ensure_collection("04_Labels")
    col_struct = ensure_collection("05_Pillars")
    col_slab = ensure_collection("06_RoofSlab_optional")

    m_ground = mat("Ground", (0.22, 0.24, 0.2))
    m_wall = mat("Wall", (0.82, 0.78, 0.72))
    m_pillar = mat("Pillar", (0.75, 0.35, 0.32))
    m_slab = mat("RoofSlab", (0.55, 0.58, 0.6), alpha=0.35)
    m_label = mat("Label", (0.15, 0.12, 0.08))

    wall_t = 0.18
    wall_h = 2.7
    floor_t = 0.04

    rooms = [r for r in data.get("rooms") or [] if r.get("id") != "roof_terrace"]

    # Ground pad slightly larger than all rooms
    xs, ys = [], []
    rects = []
    for room in rooms:
        x0, y0, x1, y1 = room_rect(room, scale)
        rects.append((room, x0, y0, x1, y1))
        xs += [x0, x1]
        ys += [y0, y1]

    if not rects:
        raise SystemExit("No rooms in house_graph.json")

    pad = 1.2
    gx0, gx1 = min(xs) - pad, max(xs) + pad
    gy0, gy1 = min(ys) - pad, max(ys) + pad
    box(
        "GroundPad",
        gx1 - gx0,
        gy1 - gy0,
        0.05,
        ((gx0 + gx1) / 2, (gy0 + gy1) / 2, -0.04),
        col_ground,
        m_ground,
    )

    for room, x0, y0, x1, y1 in rects:
        kind = room.get("kind") or "room"
        color = KIND_COLOR.get(kind, (0.6, 0.6, 0.58))
        m_floor = mat(f"Floor_{room['id']}", color)
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        sx, sy = (x1 - x0) - wall_t, (y1 - y0) - wall_t
        box(
            f"Floor_{room['id']}",
            max(sx, 0.3),
            max(sy, 0.3),
            floor_t,
            (cx, cy, floor_t / 2),
            col_floors,
            m_floor,
        )

        # Four walls on the room rectangle
        h = float(room.get("ceiling_h_m") or wall_h)
        specs = [
            (f"Wall_{room['id']}_S", x1 - x0, wall_t, h, (cx, y0, h / 2)),
            (f"Wall_{room['id']}_N", x1 - x0, wall_t, h, (cx, y1, h / 2)),
            (f"Wall_{room['id']}_W", wall_t, y1 - y0, h, (x0, cy, h / 2)),
            (f"Wall_{room['id']}_E", wall_t, y1 - y0, h, (x1, cy, h / 2)),
        ]
        for n, wx, wy, wz, loc in specs:
            box(n, wx, wy, wz, loc, col_walls, m_wall)

        label = add_label(f"Label_{room['id']}", cx, cy, h + 0.15, col_labels)
        label.data.materials.append(m_label)

    for p in (data.get("structure") or {}).get("pillars") or []:
        w = float(p.get("width_m") or 0.35) * scale
        d = float(p.get("depth_m") or 0.35) * scale
        h = float(p.get("height_m") or wall_h)
        box(
            f"Pillar_{p['id']}",
            w,
            d,
            h,
            (float(p["x_m"]) * scale, float(p["y_m"]) * scale, h / 2),
            col_struct,
            m_pillar,
        )

    # Optional roof slab above walls so the plan stays readable from above
    plot = (data.get("structure") or {}).get("plot_footprint") or {}
    if plot:
        pw = float(plot.get("width_m") or (max(xs) - min(xs)))
        pd = float(plot.get("depth_m") or (max(ys) - min(ys)))
        ox = float(plot.get("origin_x_m") or min(xs))
        oy = float(plot.get("origin_y_m") or min(ys))
    else:
        pw, pd = max(xs) - min(xs), max(ys) - min(ys)
        ox, oy = min(xs), min(ys)
    slab_t = 0.12
    slab = box(
        "RoofSlab",
        pw,
        pd,
        slab_t,
        (ox + pw / 2, oy + pd / 2, wall_h + slab_t / 2 + 0.05),
        col_slab,
        m_slab,
    )
    # Keep slab in the file but hidden so the floor plan is what you see
    slab.hide_set(True)
    slab.hide_render = True

    out_blend.parent.mkdir(parents=True, exist_ok=True)
    # Look-down camera so opening the file frames the plan
    bpy.ops.object.camera_add(
        location=((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2 - 18, 22)
    )
    cam = bpy.context.active_object
    cam.name = "PlanCamera"
    cam.rotation_euler = (0.95, 0, 0)
    scene.camera = cam
    link(cam, col_ground)

    bpy.ops.wm.save_as_mainfile(filepath=str(out_blend))
    print(f"Saved {out_blend} rooms={len(rects)}")


if __name__ == "__main__":
    main()
