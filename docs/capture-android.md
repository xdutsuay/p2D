# Android capture (ARCore → auto labels)

Lite capture for p2D: walk a property with an ARCore phone, export metric poses + video, ingest keyframes into the existing labeler.

This is **not** LiDAR mesh. You get metric camera path + facing + ordered neighbors; room names and `shows` tags stay manual QA.

## Requirements

- Phone on the [ARCore supported devices](https://developers.google.com/ar/devices) list
- [Google Play Services for AR](https://play.google.com/store/apps/details?id=com.google.ar.core) installed
- Android Studio (JDK 17) to build `apps/capture-android`
- Desktop: Node 20+, [ffmpeg](https://ffmpeg.org/) on `PATH` for frame extract
- Real device (emulator cannot record AR)

## Capture package format

Each session writes (v2 snap-first):

```text
…/captures/capture_YYYYMMDD_HHMMSS/
  video.mp4        # fill — continuous AR video
  poses.jsonl      # fill — dense trajectory
  snaps.jsonl      # PRIMARY nodes
  snaps/snap_001.jpg
  manifest.json    # primary: "snaps", snap_count, …
```

Schema / types: [`packages/schema`](../packages/schema/) (`CapturePoseSample`, `CaptureManifest`). Field mapping: [`packages/schema/CAPTURE_MAPPING.md`](../packages/schema/CAPTURE_MAPPING.md).

We **do not** rely on ARCore’s proprietary MP4 sensor tracks for offline tools — poses live in the JSONL sidecar.

## Build & install the app

```powershell
cd apps\capture-android
.\gradlew.bat :app:installDebug
```

Or open `apps/capture-android` in Android Studio → Run on a physical ARCore device.

If Gradle says SDK not found, create `apps/capture-android/local.properties` (gitignored):

```properties
sdk.dir=C:\\Users\\YOU\\AppData\\Local\\Android\\Sdk
```

App id: `local.p2d.capture` (launcher name **p2D Capture**).

Base code is Google’s `recording_playback_java` sample (Apache-2.0); see [`apps/capture-android/NOTICE`](../apps/capture-android/NOTICE).

## How to walk (snap-first)

1. Good light; wait until planes / **track TRACKING** on the status line.
2. **START**, then walk rooms slowly.
3. At each important view tap **SNAP** — app briefly switches to the highest CPU resolution, saves the still, then returns to low-res tracking.
   - Toggle **Exterior / Interior / Door-Thresh** before snapping.
   - Status shows `track WxH / snap WxH` and `HD …` while capturing.
4. Video + `poses.jsonl` keep recording in the background (fill / trajectory).
5. **STOP** — copy the `capture_*` folder:

```powershell
adb pull /sdcard/Android/data/local.p2d.capture/files/captures/ ./data/private/captures/
```

Privacy: keep captures under `data/private/` (gitignored).

Ingest options: `--fill-video`, `--distance-m`, `--turn-deg`, `--max-jump-m`, `--replace`, `--scale-seed`.

Then `npm run labeler` → Source **AR capture (CAP-)**.


```powershell
node scripts/make-fixture-capture.mjs
# ensure data/fixtures/capture_20260101_120000/video.mp4 exists (script assumes prior ffmpeg, or re-encode)
npm run ingest:capture -- ./data/fixtures/capture_20260101_120000
```

## Tracking failures

Frames with `tracking != TRACKING` are marked `usable_for: ["discard"]` and `quality: "poor"`. Dark / featureless rooms will drop poses — re-walk with more visual features or better light.

## Out of scope (for now)

- Full mesh / Gaussian splat
- On-device room naming
- iOS / App Store / Play Store release
- Feeding poses into Blender cameras (follow-up on `import_house_graph.py`)
