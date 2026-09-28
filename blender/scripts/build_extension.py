"""
Build first-floor extension options on top of ground slab.
Reads house_graph.json extension.options and writes extension_opt_a.blend (+ b).
Invoked: blender --background --python build_extension.py -- <project_root>
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import bpy


def argv_after_dd():
    if "--" in sys.argv:
        return sys.argv[sys.argv.index("--") + 1 :]
    return []


def ensure_collection(name: str):
    col = bpy.data.collections.get(name)
    if col is None:
        col = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(col)
    return col


def link(obj, col):
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    col.objects.link(obj)


def mat(name: str, color):
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        bsdf = m.node_tree.nodes.get("Principled BSDF")
        if bsdf:
            bsdf.inputs["Base Color"].default_value = (*color, 1.0)
            # slight transparency cue for proposed massing
            if "Alpha" in bsdf.inputs:
                bsdf.inputs["Alpha"].default_value = 0.65
            m.blend_method = "BLEND"
    return m


def box(name, sx, sy, sz, loc, collection, material):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (sx, sy, sz)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if material:
        obj.data.materials.append(material)
    link(obj, collection)
    return obj


def wall_from_segment(seg, z0, collection, material, prefix):
    x0, y0 = float(seg["x0_m"]), float(seg["y0_m"])
    x1, y1 = float(seg["x1_m"]), float(seg["y1_m"])
    h = float(seg.get("height_m") or 3.0)
    t = float(seg.get("thickness_m") or 0.23)
    dx, dy = x1 - x0, y1 - y0
    length = math.hypot(dx, dy) or 0.01
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    angle = math.atan2(dy, dx)
    obj = box(
        f"{prefix}_{seg['id']}",
        length,
        t,
        h,
        (cx, cy, z0 + h / 2),
        collection,
        material,
    )
    obj.rotation_euler[2] = angle
    return obj


def build_option(root: Path, data: dict, option: dict, ground_blend: Path):
    bpy.ops.wm.open_mainfile(filepath=str(ground_blend))

    storey = float((data.get("extension") or {}).get("storey_height_m") or 3.0)
    slab = (data.get("structure") or {}).get("slab") or {}
    slab_h = float(slab.get("height_m") or 3.0)
    slab_t = float(slab.get("thickness_m") or 0.15)
    z0 = slab_h + slab_t  # first-floor floor level

    plot = (data.get("structure") or {}).get("plot_footprint") or {}
    pw = float(plot.get("width_m") or 12)
    pd = float(plot.get("depth_m") or 18)
    ox = float(plot.get("origin_x_m") or 0)
    oy = float(plot.get("origin_y_m") or 0)

    col = ensure_collection(f"10_Extension_{option['id']}")
    m_wall = mat(f"ExtWall_{option['id']}", (0.35, 0.55, 0.7))
    m_pillar = mat(f"ExtPillar_{option['id']}", (0.25, 0.45, 0.65))
    m_slab = mat(f"ExtSlab_{option['id']}", (0.4, 0.5, 0.6))

    # First-floor slab (may be smaller than plot for option-specific footprint)
    fw = float(option.get("footprint_width_m") or pw)
    fd = float(option.get("footprint_depth_m") or pd * 0.7)
    fox = float(option.get("footprint_origin_x_m") or ox)
    foy = float(option.get("footprint_origin_y_m") or oy)
    box(
        f"FF_Slab_{option['id']}",
        fw,
        fd,
        slab_t,
        (fox + fw / 2, foy + fd / 2, z0 + storey + slab_t / 2),
        col,
        m_slab,
    )

    for seg in option.get("walls") or []:
        wall_from_segment(seg, z0, col, m_wall, f"FFW_{option['id']}")

    # Default: lift ground pillars that are load_bearing
    pillars = option.get("pillars")
    if pillars is None:
        pillars = [
            {
                **p,
                "id": f"ff_{p['id']}",
                "height_m": storey,
            }
            for p in (data.get("structure") or {}).get("pillars") or []
            if p.get("load_bearing", True)
        ]

    for p in pillars:
        w = float(p.get("width_m") or 0.35)
        d = float(p.get("depth_m") or 0.35)
        h = float(p.get("height_m") or storey)
        box(
            f"FF_Pillar_{p['id']}",
            w,
            d,
            h,
            (float(p["x_m"]), float(p["y_m"]), z0 + h / 2),
            col,
            m_pillar,
        )

    out = root / ".blenderassets" / f"extension_{option['id']}.blend"
    out.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(out))
    print(f"Saved {out}")


def main():
    args = argv_after_dd()
    root = Path(args[0]) if args else Path(__file__).resolve().parents[2]
    graph_path = root / "data" / "private" / "house_graph.json"
    ground = root / ".blenderassets" / "house_ground.blend"
    data = json.loads(graph_path.read_text(encoding="utf-8"))

    if not ground.exists():
        raise SystemExit(f"Missing {ground}; run import first")

    options = (data.get("extension") or {}).get("options") or []
    if not options:
        raise SystemExit("No extension.options in house_graph.json")

    for opt in options:
        build_option(root, data, opt, ground)


if __name__ == "__main__":
    main()
