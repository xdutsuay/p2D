# p2D — Photo → house 3D

Local pipeline that turns a house walkthrough into editable architectural massing in Blender.

```text
ARCore phone (snaps + poses + video)
        ↓  npm run ingest:capture
Photo catalog + labeler QA
        ↓  house_graph.json
Blender massing / extension options
```

Snaps are the **primary nodes** (intentional photos with metric pose). Continuous video + `poses.jsonl` are fill for trajectory and texture.

## Features

- **Android capture app** (`apps/capture-android`) — ARCore session, SNAP stills with pose/facing/location, background video + dense poses
- **Labeler** (`apps/labeler`) — refine rooms, neighbors, scale, `shows` tags
- **Shared schemas** (`packages/schema`) — PhotoRecord, HouseGraph, capture manifest/snaps/poses
- **Blender scripts** — import house graph, export GLB, first-floor extension options
- **Optional Blender MCP** — live control from Cursor when the addon is running

## Requirements

| Piece | Need |
|-------|------|
| Node | ≥ 20 |
| Phone | [ARCore-supported](https://developers.google.com/ar/devices) Android + Play Services for AR |
| Desktop video ingest fill | [ffmpeg](https://ffmpeg.org/) on `PATH` |
| Blender | 5.x (see [docs/blender-setup.md](docs/blender-setup.md)) |
| Android build | JDK 17, Android SDK (platforms 34–36) |

## Quick start (labeler)

```powershell
npm install
npm run labeler
```

Open http://localhost:5173 — photos and catalogs live under `data/private/` (gitignored).

Useful scripts:

```powershell
npm run label:first-pass
npm run seed:catalog
npm run ingest:capture -- .\data\private\captures\capture_YYYYMMDD_HHMMSS
npm run blender:import
npm run blender:export
npm run blender:extension
```

## Capture → auto labels

1. Build/install the app:

```powershell
cd apps\capture-android
# create local.properties with: sdk.dir=C:\\Users\\YOU\\AppData\\Local\\Android\\Sdk
.\gradlew.bat :app:installDebug
```

2. On device: **START** → walk → **SNAP** at corners/doors/facades (toggle Exterior / Interior / Door) → **STOP**.

3. Pull and ingest:

```powershell
adb pull /sdcard/Android/data/local.p2d.capture/files/captures/ ./data/private/captures/
npm run ingest:capture -- ./data/private/captures/capture_YYYYMMDD_HHMMSS
npm run labeler
```

Capture package (v2):

```text
capture_YYYYMMDD_HHMMSS/
  video.mp4       # fill
  poses.jsonl     # fill / trajectory
  snaps.jsonl     # PRIMARY nodes
  snaps/*.jpg
  manifest.json
```

Full guide: [docs/capture-android.md](docs/capture-android.md).

Ingest flags: `--fill-video`, `--distance-m`, `--turn-deg`, `--max-jump-m`, `--replace`, `--scale-seed`.

## Repo layout

```text
apps/capture-android/   ARCore capture (Apache-2.0 sample + p2D writers)
apps/labeler/           Vite + React labeling UI
packages/schema/        Shared TS types + JSON Schema
scripts/                ingest, seed, blender runners
blender/scripts/        bpy import / export / extension
docs/                   setup + product notes
data/fixtures/          synthetic capture for ingest tests
data/private/           local photos/catalogs (not committed)
```

## Docs

| Doc | Topic |
|-----|--------|
| [docs/capture-android.md](docs/capture-android.md) | Phone capture + ingest |
| [docs/blender-setup.md](docs/blender-setup.md) | Blender paths / scripts |
| [docs/blender-mcp.md](docs/blender-mcp.md) | MCP live control |
| [docs/product-photo-to-3d.md](docs/product-photo-to-3d.md) | Later product path |
| [packages/schema/CAPTURE_MAPPING.md](packages/schema/CAPTURE_MAPPING.md) | Snap → PhotoRecord mapping |

## Privacy

House photos and graphs stay in `data/private/` / `.tempphotos_donotsteal/` and are **gitignored**. Do not commit real captures.

## License notes

- p2D project code: use as you like in this private repo unless you add a LICENSE later.
- `apps/capture-android` includes Google ARCore sample code under **Apache-2.0** — see [apps/capture-android/NOTICE](apps/capture-android/NOTICE).
