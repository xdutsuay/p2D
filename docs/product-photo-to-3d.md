# Later: photo → 3D product (byproduct)

Do **not** block the house architectural pipeline on this. This documents the product path once the house workflow is proven.

## Problem

Users upload photos of a home / school / building and receive a 3D asset (GLB or splat) plus an optional simplified architectural massing.

## Capture guide (required for automatic reconstruction)

| Capture | Guidance |
|---------|----------|
| Exterior orbit | Walk around the building; 70%+ overlap between frames |
| Height | Include ground, mid, and eaves / roof edge |
| Interior | Good light; avoid motion blur; shoot corners and openings |
| Scale | Place a known object (door, meter stick) in at least 2 frames |
| Avoid | Single walkthrough with sparse frames (like the current house set) for mesh quality |

The labeling schema in `packages/schema` is the QA layer: tag `usable_for: massing|discard` after reconstruction.

## Pipeline options to evaluate

1. **Photogrammetry mesh** — COLMAP or Meshroom → densify → mesh → optional remesh / retopo for architecture.
2. **Gaussian splat** — fast visual proxy for clients; convert or draw over for walls later.
3. **Hybrid (recommended for properties)** — splat or mesh for context + **architectural massing** (same as p2D house path) for editable walls/pillars/slab.

## Suggested API shape

```http
POST /jobs
  multipart: photos[]
  json: { kind: "property"|"object", want: ["glb","splat","massing"] }

GET /jobs/:id
  → { status, progress, artifacts: [{ type, url }] }
```

Jobs run async (worker + queue). Local MVP can be a CLI:

```text
p2d reconstruct ./capture_folder --out ./out
```

## What p2D already provides for the product

- Photo catalog + house graph schemas
- Labeling UI patterns (QA of captures)
- Blender import of massing from structured JSON
- Extension overlay idea (multi-storey planning)

## Out of scope until house v1 works

- Cloud hosting, billing, auth
- Full automatic floor-plan vectorization

## Mobile capture (in progress)

See [capture-android.md](capture-android.md). ARCore app writes `video.mp4` + `poses.jsonl`; `npm run ingest:capture` feeds the labeler.
