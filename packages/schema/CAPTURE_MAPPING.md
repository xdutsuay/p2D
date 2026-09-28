# Capture → PhotoRecord mapping

Portable capture package from `apps/capture-android` (v2 snap-first):

```text
capture_YYYYMMDD_HHMMSS/
  video.mp4           # fill — continuous AR video
  poses.jsonl         # fill — dense trajectory
  snaps.jsonl         # PRIMARY — intentional still nodes
  snaps/snap_001.jpg
  manifest.json       # primary: "snaps"
```

## Engineering model (Blender)

1. **Snap = node** — each SNAP is a PhotoRecord / camera in Blender with metric pose.
2. **poses.jsonl** — connects nodes (path, adjacency, scale).
3. **video.mp4** — optional fill frames / texture only when snaps are sparse.

## Auto-filled by `npm run ingest:capture`

| Source | PhotoRecord field |
|--------|-------------------|
| `snaps/*.jpg` (preferred) | `filename`, `id`, `photo_code` |
| Video keyframes | only if `--fill-video` or zero snaps |
| `facing` | `facing` |
| `location_type` on snap | `location_type` |
| Trajectory neighbors | `adjacents.front` / `back` |
| `tracking != TRACKING` / teleports | skipped or `usable_for: discard` |

## Left for labeler QA

- `room_id`, `shows`, `notes`
- Fine-grained left/right/top/bottom neighbors
