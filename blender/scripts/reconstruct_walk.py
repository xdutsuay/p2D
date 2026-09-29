"""
Metric walk reconstruction from an AR capture.

Places TRACKING camera path + posed photo planes (AR snaps and video fills)
in Blender. Set-1 phone stills have no pose — they stay in a side collection,
hidden from the main view.

blender --background --python reconstruct_walk.py -- <project_root>
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import bpy
import mathutils


FACING_YAW = {
    "N": 0,
    "NE": 45,
    "E": 90,
    "SE": 135,
    "S": 180,
    "SW": 225,
    "W": 270,
    "NW": 315,
}


def argv_after_dd():
    if "--" in sys.argv:
        return sys.argv[sys.argv.index("--") + 1 :]
    return []


def dist3(a, b):
    return math.sqrt(sum((a[i] - b[i]) ** 2 for i in range(3)))


def ar_to_blender(pos):
    """ARCore Y-up (x, y, z) → Blender Z-up (x, z, y)."""
    x, y, z = pos
    return mathutils.Vector((float(x), float(z), float(y)))


def yaw_forward_blender(yaw_deg):
    """Match CaptureSessionWriter.yawDegFromPose: atan2(fx, -fz)."""
    yaw = math.radians(yaw_deg)
    # AR forward (sin(yaw), 0, -cos(yaw)) → blender XY
    return mathutils.Vector((math.sin(yaw), -math.cos(yaw), 0.0))


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for coll in list(bpy.data.collections):
        bpy.data.collections.remove(coll)


def ensure_collection(name: str):
    col = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(col)
    return col


def link_only(obj, col):
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    col.objects.link(obj)


def load_poses(path: Path):
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            rows.append(json.loads(line))
    return rows


def sane_pos(pos, limit=40.0):
    return pos and len(pos) >= 3 and all(abs(float(c)) < limit for c in pos[:3])


def path_segments(poses, min_step=0.35, max_jump=2.0):
    """TRACKING samples inside a house-scale box, split when the tracker teleports."""
    segments = []
    current = []
    last = None
    for p in poses:
        if p.get("tracking") != "TRACKING":
            continue
        pos = p.get("pos_m")
        if not sane_pos(pos):
            continue
        if last is not None and dist3(pos, last) > max_jump:
            if len(current) >= 2:
                segments.append(current)
            current = []
            last = None
        if last is not None and dist3(pos, last) < min_step:
            continue
        current.append(p)
        last = pos
    if len(current) >= 2:
        segments.append(current)
    return segments


def make_path_mesh(points, collection, name="Walk"):
    mesh = bpy.data.meshes.new(name + "Mesh")
    mesh.from_pydata(points, [(i, i + 1) for i in range(len(points) - 1)], [])
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    # Give the polyline a visible bevel via a skin-like curve duplicate
    curve_data = bpy.data.curves.new(name + "Curve", type="CURVE")
    curve_data.dimensions = "3D"
    curve_data.bevel_depth = 0.03
    curve_data.bevel_resolution = 2
    spline = curve_data.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for i, p in enumerate(points):
        spline.points[i].co = (p[0], p[1], p[2], 1.0)
    curve_obj = bpy.data.objects.new(name + "Tube", curve_data)
    mat = bpy.data.materials.new("WalkMat")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (0.15, 0.85, 0.35, 1.0)
        bsdf.inputs["Emission Color"].default_value = (0.1, 0.6, 0.25, 1.0)
        bsdf.inputs["Emission Strength"].default_value = 0.4
    curve_obj.data.materials.append(mat)
    collection.objects.link(curve_obj)
    return curve_obj


def image_plane(name, image_path: Path, collection, width=0.9):
    bpy.ops.mesh.primitive_plane_add(size=1.0)
    obj = bpy.context.active_object
    obj.name = name
    obj.show_name = False
    if image_path.exists():
        image = bpy.data.images.load(str(image_path), check_existing=True)
        try:
            image.pack()
        except RuntimeError:
            pass
        mat = bpy.data.materials.new(name + "_mat")
        mat.use_nodes = True
        mat.use_backface_culling = False
        nt = mat.node_tree
        nt.nodes.clear()
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        emit = nt.nodes.new("ShaderNodeEmission")
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = image
        tex.extension = "CLIP"
        emit.inputs["Strength"].default_value = 1.0
        nt.links.new(tex.outputs["Color"], emit.inputs["Color"])
        nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])
        obj.data.materials.append(mat)
        w, h = image.size
        aspect = (w / float(h)) if h else 1.0
        obj.scale = (width * aspect * 0.5, width * 0.5, 1.0)
    link_only(obj, collection)
    return obj


def add_id_label(photo_id, location, collection):
    curve = bpy.data.curves.new(photo_id + "_lbl", type="FONT")
    curve.body = photo_id
    curve.size = 0.22
    curve.align_x = "CENTER"
    obj = bpy.data.objects.new(photo_id + "_label", curve)
    obj.location = (location.x, location.y, location.z + 0.15)
    collection.objects.link(obj)
    return obj


def yaw_delta(a, b):
    d = abs(a - b) % 360.0
    if d > 180.0:
        d = 360.0 - d
    return d


def orient_card(obj, cam_bl, yaw_deg, stand_off=1.1):
    forward = yaw_forward_blender(yaw_deg)
    obj.location = cam_bl + forward * stand_off
    # Vertical plane whose normal points back toward the camera.
    yaw = math.radians(yaw_deg)
    obj.rotation_euler = (math.pi / 2.0, 0.0, yaw)


def main():
    args = argv_after_dd()
    root = Path(args[0]) if args else Path(__file__).resolve().parents[2]
    capture = root / ".tempphotos_donotsteal" / "capture_20260929_120630"
    catalog_path = root / "data" / "private" / "photo_catalog.json"
    photos_dir = root / "data" / "private" / "photos"
    out_blend = root / ".blenderassets" / "walk_reconstruction.blend"
    preview = root / ".blenderassets" / "walk_preview.png"
    out_blend.parent.mkdir(parents=True, exist_ok=True)

    poses_path = capture / "poses.jsonl"
    if not poses_path.exists():
        raise SystemExit(f"Missing {poses_path}")
    if not catalog_path.exists():
        raise SystemExit(f"Missing {catalog_path}")

    poses = load_poses(poses_path)
    segments = path_segments(poses)
    path_samples = [p for seg in segments for p in seg]
    if len(path_samples) < 2:
        raise SystemExit("Not enough stable TRACKING poses")

    clear_scene()
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0

    col_path = ensure_collection("01_Walk")
    col_snaps = ensure_collection("02_Snaps")
    col_fill = ensure_collection("03_Fill")
    col_set1 = ensure_collection("04_Set1_real")
    col_corners = ensure_collection("05_Corners90")

    bl_points = []
    for i, seg in enumerate(segments):
        pts = [ar_to_blender(p["pos_m"]) for p in seg]
        bl_points.extend(pts)
        make_path_mesh([(p.x, p.y, p.z) for p in pts], col_path, name=f"Walk_{i:03d}")

    # Ground disc under the walked area
    xs = [p.x for p in bl_points]
    ys = [p.y for p in bl_points]
    cx = sum(xs) / len(xs)
    cy = sum(ys) / len(ys)
    span = max(max(xs) - min(xs), max(ys) - min(ys), 4.0)
    bpy.ops.mesh.primitive_plane_add(size=span * 1.4, location=(cx, cy, min(p.z for p in bl_points) - 1.5))
    ground = bpy.context.active_object
    ground.name = "Ground"
    gmat = bpy.data.materials.new("GroundMat")
    gmat.use_nodes = True
    gbsdf = gmat.node_tree.nodes.get("Principled BSDF")
    if gbsdf:
        gbsdf.inputs["Base Color"].default_value = (0.18, 0.18, 0.2, 1.0)
    ground.data.materials.append(gmat)
    link_only(ground, col_path)

    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    placed = 0
    set1_n = 0
    rejected = 0
    cards = []  # posed photos used for 90° suggestions

    for photo in catalog.get("photos") or []:
        src = photo.get("source")
        img = photos_dir / photo["filename"]
        pose = photo.get("pose_m") or {}
        pos = pose.get("pos_m")
        pid = photo.get("id") or ""
        if src == "set1_phone" or not pos:
            # Real phone stills, visible review wall (no AR pose on this set).
            obj = image_plane(pid, img, col_set1, width=1.8)
            coln = set1_n % 8
            row = set1_n // 8
            obj.location = mathutils.Vector(
                (cx + span * 0.55 + coln * 2.4, cy - row * 1.8, 1.2)
            )
            obj.rotation_euler = (math.pi / 2, 0, 0)
            add_id_label(pid, obj.location, col_set1)
            obj["p2d_id"] = pid
            obj["p2d_comment"] = ""
            obj["p2d_90_with"] = ""
            obj["p2d_notes"] = photo.get("notes") or ""
            obj["p2d_source"] = "set1_phone"
            set1_n += 1
            continue

        if not sane_pos(pos):
            rejected += 1
            continue
        cam = ar_to_blender(pos)
        facing = photo.get("facing") or "N"
        yaw = FACING_YAW.get(facing, 0)
        col = col_snaps if src == "ar_snap" else col_fill
        width = 2.4 if src == "ar_snap" else 1.6
        obj = image_plane(pid, img, col, width=width)
        orient_card(obj, cam, yaw, stand_off=1.4 if src == "ar_snap" else 1.0)
        add_id_label(pid, obj.location, col)
        obj["p2d_id"] = pid
        obj["p2d_comment"] = ""
        obj["p2d_90_with"] = ""
        obj["p2d_notes"] = photo.get("notes") or ""
        obj["p2d_facing"] = facing
        obj["p2d_source"] = src or ""
        obj["p2d_yaw"] = float(yaw)
        cards.append(obj)
        placed += 1

    # Suggest pairs whose facings differ by ~90° and that stand near each other.
    corner_n = 0
    for i, a in enumerate(cards):
        best = None
        best_d = 2.8
        ay = float(a.get("p2d_yaw", 0))
        for b in cards[i + 1 :]:
            delta = yaw_delta(ay, float(b.get("p2d_yaw", 0)))
            if delta < 75 or delta > 105:
                continue
            dist = (a.location - b.location).length
            if dist < best_d:
                best = b
                best_d = dist
        if best is None:
            continue
        prev = str(a.get("p2d_90_with") or "")
        a["p2d_90_with"] = best.name if not prev else prev + "," + best.name
        bprev = str(best.get("p2d_90_with") or "")
        if a.name not in bprev.split(","):
            best["p2d_90_with"] = a.name if not bprev else bprev + "," + a.name
        mesh = bpy.data.meshes.new(f"Corner90_{corner_n:03d}")
        mesh.from_pydata(
            [tuple(a.location), tuple(best.location)],
            [(0, 1)],
            [],
        )
        mesh.update()
        link = bpy.data.objects.new(f"90_{a.name}_{best.name}", mesh)
        col_corners.objects.link(link)
        corner_n += 1

    # 3/4 camera on the longest continuous segment so cards are face-on, not edge-on.
    longest = max(segments, key=len)
    focus_pts = [ar_to_blender(p["pos_m"]) for p in longest]
    fx = sum(p.x for p in focus_pts) / len(focus_pts)
    fy = sum(p.y for p in focus_pts) / len(focus_pts)
    fz = sum(p.z for p in focus_pts) / len(focus_pts)
    fspan = max(
        max(p.x for p in focus_pts) - min(p.x for p in focus_pts),
        max(p.y for p in focus_pts) - min(p.y for p in focus_pts),
        6.0,
    )
    cam_data = bpy.data.cameras.new("Overview")
    cam_data.lens = 28
    cam_obj = bpy.data.objects.new("Overview", cam_data)
    cam_obj.location = (fx + fspan * 0.35, fy - fspan * 0.85, fz + fspan * 0.45)
    direction = mathutils.Vector((fx, fy, fz + 1.2)) - cam_obj.location
    cam_obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    col_path.objects.link(cam_obj)
    scene.camera = cam_obj

    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720
    scene.render.filepath = str(preview)
    scene.render.image_settings.file_format = "PNG"
    try:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    except TypeError:
        scene.render.engine = "BLENDER_EEVEE"
    bpy.ops.render.render(write_still=True)

    for window in bpy.context.window_manager.windows:
        for area in window.screen.areas:
            if area.type == "VIEW_3D":
                area.spaces.active.shading.type = "MATERIAL"

    bpy.ops.wm.save_as_mainfile(filepath=str(out_blend))
    print(
        f"Saved {out_blend} path_pts={len(bl_points)} placed={placed} "
        f"set1={set1_n} corners90={corner_n} rejected_jumps={rejected}"
    )


if __name__ == "__main__":
    main()
