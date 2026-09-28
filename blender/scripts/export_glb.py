"""
Export .blenderassets/house_ground.blend to GLB for preview.
Invoked: blender --background --python export_glb.py -- <project_root>
"""
from __future__ import annotations

import sys
from pathlib import Path

import bpy


def argv_after_dd():
    if "--" in sys.argv:
        return sys.argv[sys.argv.index("--") + 1 :]
    return []


def main():
    args = argv_after_dd()
    root = Path(args[0]) if args else Path(__file__).resolve().parents[2]
    blend = root / ".blenderassets" / "house_ground.blend"
    out = root / ".blenderassets" / "house_ground.glb"

    if not blend.exists():
        raise SystemExit(f"Missing {blend}; run import_house_graph first")

    bpy.ops.wm.open_mainfile(filepath=str(blend))
    out.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(out),
        export_format="GLB",
        use_selection=False,
    )
    print(f"Exported {out}")


if __name__ == "__main__":
    main()
