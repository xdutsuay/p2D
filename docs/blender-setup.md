# Blender setup (p2D)

## Installed version

- **Blender:** 5.2.2 LTS
- **Path:** `C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`

Override with env var `BLENDER_PATH` if installed elsewhere.

## Headless / CLI usage

From repo root:

```powershell
npm run blender:import
npm run blender:export
npm run blender:extension
```

These wrap:

```text
blender.exe --background --python blender/scripts/<script>.py -- <args>
```

## Working files

| File | Purpose |
|------|---------|
| `.blenderassets/house_ground.blend` | Ground-floor architectural model |
| `.blenderassets/house_ground.glb` | Preview export |
| `.blenderassets/extension_opt_a.blend` | First-floor option A |
| `data/private/house_graph.json` | Source of truth for massing import |

## Cursor integration

1. Prefer MCP when a Blender MCP server is connected (run Python, open/save `.blend`).
2. Fallback: CLI scripts above — Cursor can run them via the terminal with the same effect.

## Python API notes

Scripts under `blender/scripts/` use `bpy` and expect to be launched **by Blender**, not system Python.

Project root is detected from the script path (`../../` from `blender/scripts/`).
