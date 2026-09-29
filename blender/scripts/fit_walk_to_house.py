"""
Fit the AR walk onto the house_ground plan.

The house layout (house_graph / house_ground.blend) is the real footprint,
about 14m x 17m. The phone walk drifts to ~64m, but the dense core within
8m of the median pose is house-sized. A similarity search (rotation, mirror,
scale, translation) drops that core onto the plan. Photos from that core are
placed inside the rooms.

Saves .blenderassets/house_walk.blend — does not overwrite house_ground.blend.
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import bpy
import mathutils


FACING_YAW = {
    "N": 0, "NE": 45, "E": 90, "SE": 135,
    "S": 180, "SW": 225, "W": 270, "NW": 315,
}


def argv_after_dd():
    if "--" in sys.argv:
        return sys.argv[sys.argv.index("--") + 1 :]
    return []


def ensure_collection(name: str):
    existing = bpy.data.collections.get(name)
    if existing:
        return existing
    col = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(col)
    return col


def link_only(obj, col):
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    col.objects.link(obj)


def load_jsonl(path: Path):
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            rows.append(json.loads(line))
    return rows


def median(vals):
    s = sorted(vals)
    return s[len(s) // 2]


def core_points(poses, radius=8.0):
    sane = []
    for p in poses:
        pos = p.get("pos_m")
        if p.get("tracking") != "TRACKING" or not pos:
            continue
        if any(abs(float(c)) > 40 for c in pos):
            continue
        sane.append((float(pos[0]), float(pos[2])))  # plan X, plan Y
    mx, my = median([a for a, _ in sane]), median([b for _, b in sane])
    core = [p for p in sane if math.hypot(p[0] - mx, p[1] - my) <= radius]
    return core, (mx, my)


def apply_xy(x, y, mirror, theta, scale, tx, ty):
    x *= mirror
    c, s = math.cos(theta), math.sin(theta)
    return (scale * (c * x - s * y) + tx, scale * (s * x + c * y) + ty)


def search_fit(points, hx0, hx1, hy0, hy1):
    sample = points[:: max(1, len(points) // 450)]
    hx, hy = (hx0 + hx1) / 2, (hy0 + hy1) / 2

    def score(mirror, deg, scale, tx, ty):
        theta = math.radians(deg)
        inside = 0
        cells = set()
        for x, y in sample:
            X, Y = apply_xy(x, y, mirror, theta, scale, tx, ty)
            if hx0 <= X <= hx1 and hy0 <= Y <= hy1:
                inside += 1
                cells.add((int(X // 2), int(Y // 2)))
        return inside / len(sample) + 0.02 * len(cells), inside / len(sample), len(cells)

    best = None

    def consider(mirror, deg, scale):
        nonlocal best
        theta = math.radians(deg)
        rot = [apply_xy(x, y, mirror, theta, scale, 0, 0) for x, y in sample]
        cx = sum(a for a, _ in rot) / len(rot)
        cy = sum(b for _, b in rot) / len(rot)
        for dx in (-3, -1, 0, 1, 3):
            for dy in (-3, -1, 0, 1, 3):
                tx, ty = hx - cx + dx, hy - cy + dy
                rec = (score(mirror, deg, scale, tx, ty), mirror, deg, scale, tx, ty)
                if best is None or rec[0][0] > best[0][0]:
                    best = rec

    for mirror in (1, -1):
        for deg in range(0, 360, 10):
            for scale in (0.9, 1.0, 1.1, 1.2):
                consider(mirror, deg, scale)

    # Refine around the coarse winner.
    _, mirror, deg, scale, _, _ = best
    best = None
    for ddeg in range(-8, 9, 2):
        for dscale in (-0.06, 0.0, 0.06):
            consider(mirror, (deg + ddeg) % 360, scale + dscale)
    (sc, inside, cells), mirror, deg, scale, tx, ty = best
    return {
        "mirror": mirror,
        "deg": deg,
        "scale": scale,
        "tx": tx,
        "ty": ty,
        "inside": inside,
        "cells": cells,
        "score": sc,
    }


def image_plane(name, image_path: Path, collection, width):
    bpy.ops.mesh.primitive_plane_add(size=1.0)
    obj = bpy.context.active_object
    obj.name = name
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
        emit.inputs["Strength"].default_value = 1.0
        nt.links.new(tex.outputs["Color"], emit.inputs["Color"])
        nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])
        obj.data.materials.append(mat)
        w, h = image.size
        aspect = (w / float(h)) if h else 1.0
        obj.scale = (width * aspect * 0.5, width * 0.5, 1.0)
    link_only(obj, collection)
    return obj


def add_label(text, loc, collection, size=0.18):
    curve = bpy.data.curves.new(text + "_lbl", type="FONT")
    curve.body = text
    curve.size = size
    curve.align_x = "CENTER"
    obj = bpy.data.objects.new(text + "_label", curve)
    obj.location = loc
    collection.objects.link(obj)
    return obj


def room_of(rects, x, y):
    for room, x0, y0, x1, y1 in rects:
        if x0 <= x <= x1 and y0 <= y <= y1:
            return room.get("id") or ""
    return ""


def main():
    args = argv_after_dd()
    root = Path(args[0]) if args else Path(__file__).resolve().parents[2]
    house_blend = root / ".blenderassets" / "house_ground.blend"
    graph_path = root / "data" / "private" / "house_graph.json"
    capture = root / ".tempphotos_donotsteal" / "capture_20260929_120630"
    catalog_path = root / "data" / "private" / "photo_catalog.json"
    photos_dir = root / "data" / "private" / "photos"
    out_blend = root / ".blenderassets" / "house_walk.blend"

    if not house_blend.exists():
        raise SystemExit(f"Missing {house_blend}")
    bpy.ops.wm.open_mainfile(filepath=str(house_blend))

    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    scale_h = float((graph.get("meta") or {}).get("scale_factor") or 1.0)
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

    poses = load_jsonl(capture / "poses.jsonl")
    core, (mx, my) = core_points(poses, radius=8.0)
    fit = search_fit(core, hx0, hx1, hy0, hy1)
    print(
        "FIT deg={deg} mirror={mirror} scale={scale:.3f} "
        "tx={tx:.2f} ty={ty:.2f} inside={inside:.2%} cells={cells}".format(**fit)
    )

    col_path = ensure_collection("10_WalkOnPlan")
    col_photos = ensure_collection("11_PhotosOnPlan")
    col_set1 = ensure_collection("12_Set1_review")

    # Floor path from the fitted core, lightly downsampled.
    path_pts = []
    last = None
    theta = math.radians(fit["deg"])
    for x, y in core:
        if last and math.hypot(x - last[0], y - last[1]) < 0.45:
            continue
        X, Y = apply_xy(x, y, fit["mirror"], theta, fit["scale"], fit["tx"], fit["ty"])
        if not (hx0 - 1 <= X <= hx1 + 1 and hy0 - 1 <= Y <= hy1 + 1):
            last = (x, y)
            continue
        path_pts.append((X, Y, 0.18))
        last = (x, y)
    if len(path_pts) >= 2:
        curve = bpy.data.curves.new("WalkOnPlan", type="CURVE")
        curve.dimensions = "3D"
        curve.bevel_depth = 0.035
        spline = curve.splines.new("POLY")
        spline.points.add(len(path_pts) - 1)
        for i, p in enumerate(path_pts):
            spline.points[i].co = (p[0], p[1], p[2], 1.0)
        obj = bpy.data.objects.new("WalkOnPlan", curve)
        mat = bpy.data.materials.new("WalkOnPlanMat")
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        if bsdf:
            bsdf.inputs["Base Color"].default_value = (0.15, 0.75, 0.35, 1)
        obj.data.materials.append(mat)
        col_path.objects.link(obj)

    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    placed = []
    set1_n = 0
    for photo in catalog.get("photos") or []:
        pid = photo.get("id") or ""
        src = photo.get("source")
        img = photos_dir / photo["filename"]
        pose = photo.get("pose_m") or {}
        pos = pose.get("pos_m")
        if src == "set1_phone" or not pos:
            obj = image_plane(pid, img, col_set1, width=1.5)
            coln = set1_n % 8
            row = set1_n // 8
            obj.location = (hx1 + 3.0 + coln * 2.0, hy1 - row * 1.5, 1.2)
            obj.rotation_euler = (math.pi / 2, 0, 0)
            add_label(pid, obj.location + mathutils.Vector((0, 0, 0.9)), col_set1)
            obj["p2d_id"] = pid
            obj["p2d_comment"] = ""
            obj["p2d_90_with"] = ""
            obj["p2d_source"] = "set1_phone"
            obj["p2d_room_id"] = ""
            set1_n += 1
            continue
        if math.hypot(float(pos[0]) - mx, float(pos[2]) - my) > 9.0:
            continue
        X, Y = apply_xy(
            float(pos[0]), float(pos[2]), fit["mirror"], theta, fit["scale"], fit["tx"], fit["ty"]
        )
        facing = photo.get("facing") or "N"
        yaw = FACING_YAW.get(facing, 0)
        # Facing direction in the original plan, then the same similarity.
        fx = math.sin(math.radians(yaw))
        fy = -math.cos(math.radians(yaw))
        Fx, Fy = apply_xy(fx, fy, fit["mirror"], theta, 1.0, 0, 0)
        # apply_xy includes translation; direction should not. Recompute without tx/ty.
        # apply_xy(..., tx=0, ty=0) still scales. Direction uses scale 1.
        forward = mathutils.Vector((Fx, Fy, 0))
        if forward.length < 1e-6:
            forward = mathutils.Vector((0, 1, 0))
        forward.normalize()
        card_yaw = math.atan2(forward.x, -forward.y)
        obj = image_plane(pid, img, col_photos, width=1.15 if src == "ar_snap" else 0.85)
        obj.location = mathutils.Vector((X, Y, 1.35)) + forward * 0.45
        obj.rotation_euler = (math.pi / 2, 0, card_yaw)
        add_label(pid, mathutils.Vector((X, Y, 2.15)), col_photos, size=0.16)
        room = room_of(rects, X, Y)
        obj["p2d_id"] = pid
        obj["p2d_comment"] = ""
        obj["p2d_90_with"] = ""
        obj["p2d_facing"] = facing
        obj["p2d_source"] = src or ""
        obj["p2d_room_id"] = room
        obj["p2d_yaw"] = math.degrees(card_yaw)
        placed.append(obj)

    # 90° suggestions in house space.
    corners = 0
    col_c = ensure_collection("13_Corners90")
    for i, a in enumerate(placed):
        best = None
        best_d = 3.2
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
        mesh = bpy.data.meshes.new(f"C90_{corners}")
        mesh.from_pydata(
            [(a.location.x, a.location.y, 0.25), (best.location.x, best.location.y, 0.25)],
            [(0, 1)],
            [],
        )
        mesh.update()
        link = bpy.data.objects.new(f"90_{a.name}_{best.name}", mesh)
        col_c.objects.link(link)
        corners += 1

    note = (
        f"Walk fitted to house plan. rot={fit['deg']} deg mirror={fit['mirror']} "
        f"scale={fit['scale']:.2f} inside={fit['inside']:.0%}. "
        "Edit p2d_comment and p2d_90_with on each photo."
    )
    print(note)
    print(f"placed={len(placed)} set1={set1_n} corners={corners} path={len(path_pts)}")

    for window in bpy.context.window_manager.windows:
        for area in window.screen.areas:
            if area.type == "VIEW_3D":
                area.spaces.active.shading.type = "MATERIAL"

    out_blend.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(out_blend))
    print(f"Saved {out_blend}")


if __name__ == "__main__":
    main()
