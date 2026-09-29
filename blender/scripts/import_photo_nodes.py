"""
Import every photo in data/private/photo_catalog.json as its own Blender object
(image plane or placeholder empty) with editable per-element comments.

- AR snaps with pose_m → placed in metric ARCore coords
- Set1 / fill without pose → laid out on a review grid (editable)
- Custom properties: p2d_id, p2d_notes, p2d_facing, p2d_source, p2d_comment

Usage:
  node scripts/run-blender.mjs import_photo_nodes.py
  blender --background --python blender/scripts/import_photo_nodes.py -- <project_root>
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


def clear_photo_collections():
    for name in ("Photos_Set1", "Photos_AR", "Photos_Fill", "Photos_All"):
        col = bpy.data.collections.get(name)
        if col:
            for obj in list(col.objects):
                bpy.data.objects.remove(obj, do_unlink=True)
            bpy.data.collections.remove(col)


def ensure_collection(name: str):
    existing = bpy.data.collections.get(name)
    if existing:
        return existing
    col = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(col)
    return col


def set_prop(obj, key, value):
    obj[key] = value if value is not None else ""


def load_image(path: Path):
    if not path.exists():
        return None
    return bpy.data.images.load(str(path), check_existing=True)


def make_plane(name: str, image, collection, size=1.2):
    bpy.ops.mesh.primitive_plane_add(size=size, location=(0, 0, 0))
    obj = bpy.context.active_object
    obj.name = name
    if image is not None:
        mat = bpy.data.materials.new(name + "_mat")
        mat.use_nodes = True
        nodes = mat.node_tree.nodes
        links = mat.node_tree.links
        nodes.clear()
        out = nodes.new("ShaderNodeOutputMaterial")
        bsdf = nodes.new("ShaderNodeBsdfPrincipled")
        tex = nodes.new("ShaderNodeTexImage")
        tex.image = image
        links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
        if obj.data.materials:
            obj.data.materials[0] = mat
        else:
            obj.data.materials.append(mat)
        # Match aspect
        w, h = image.size[0], image.size[1]
        if w > 0 and h > 0:
            aspect = w / float(h)
            obj.scale = (size * aspect * 0.5, size * 0.5, 1.0)
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    collection.objects.link(obj)
    return obj


def quat_xyzw_to_euler(q):
    """ARCore quat xyzw → Blender XYZ euler (approx display-oriented)."""
    x, y, z, w = q
    # Convert to Blender: keep as-is for now; user can rotate. Store raw too.
    # Simple yaw-from-quat for upright cameras
    siny_cosp = 2 * (w * y + z * x)
    cosy_cosp = 1 - 2 * (y * y + z * z)
    yaw = math.atan2(siny_cosp, cosy_cosp)
    return (math.pi / 2, 0.0, yaw)


def main():
    args = argv_after_dd()
    root = Path(args[0]) if args else Path(__file__).resolve().parents[2]
    catalog_path = root / "data" / "private" / "photo_catalog.json"
    photos_dir = root / "data" / "private" / "photos"
    out_blend = root / ".blenderassets" / "photo_nodes.blend"
    out_blend.parent.mkdir(parents=True, exist_ok=True)

    if not catalog_path.exists():
        raise SystemExit(f"Missing {catalog_path} — run: node scripts/build-combined-private.mjs")

    data = json.loads(catalog_path.read_text(encoding="utf-8"))
    photos = data.get("photos") or []

    clear_photo_collections()
    col_all = ensure_collection("Photos_All")
    col_s1 = ensure_collection("Photos_Set1")
    col_ar = ensure_collection("Photos_AR")
    col_fl = ensure_collection("Photos_Fill")

    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"

    grid_i = 0
    for p in photos:
        src = p.get("source") or "unknown"
        col = col_s1 if src == "set1_phone" else col_ar if src == "ar_snap" else col_fl if src == "ar_fill" else col_all
        img_path = photos_dir / p["filename"]
        image = load_image(img_path)
        obj = make_plane(p["id"], image, col, size=1.0)
        if obj.name not in col_all.objects:
            try:
                col_all.objects.link(obj)
            except RuntimeError:
                pass

        set_prop(obj, "p2d_id", p.get("id"))
        set_prop(obj, "p2d_notes", p.get("notes") or "")
        set_prop(obj, "p2d_comment", "")  # freeform QA note in Blender
        set_prop(obj, "p2d_facing", p.get("facing") or "")
        set_prop(obj, "p2d_source", src)
        set_prop(obj, "p2d_room_id", p.get("room_id") or "")
        set_prop(obj, "p2d_filename", p.get("filename") or "")

        pose = p.get("pose_m")
        if pose and pose.get("pos_m"):
            x, y, z = pose["pos_m"]
            obj.location = (float(x), float(z), float(y))  # AR Y-up-ish → Blender Z-up swap Y/Z
            if pose.get("quat_xyzw"):
                obj.rotation_euler = quat_xyzw_to_euler(pose["quat_xyzw"])
        else:
            # Review grid for set1 / unposed fills
            row = grid_i // 10
            coln = grid_i % 10
            obj.location = (coln * 1.6, -row * 1.4, 0.0)
            obj.rotation_euler = (math.pi / 2, 0.0, 0.0)
            grid_i += 1

    # Text object with instructions
    curve = bpy.data.curves.new("P2D_Help", type="FONT")
    curve.body = (
        "Select a photo plane → Object Properties → Custom Properties\n"
        "Edit p2d_comment / p2d_notes per element.\n"
        "AR snaps are metric; Set1 is on a review grid."
    )
    curve.size = 0.25
    help_obj = bpy.data.objects.new("P2D_Help", curve)
    help_obj.location = (0, 2.5, 2.0)
    col_all.objects.link(help_obj)

    bpy.ops.wm.save_as_mainfile(filepath=str(out_blend))
    print(f"Saved {out_blend} with {len(photos)} photo nodes")


if __name__ == "__main__":
    main()
