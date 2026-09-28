# p2D Capture (Android / ARCore)

Vendored from Google's [`recording_playback_java`](https://github.com/google-ar/arcore-android-sdk/tree/main/samples/recording_playback_java) sample (Apache-2.0), customized for **snap-first** house capture.

```text
Android/data/local.p2d.capture/files/captures/capture_YYYYMMDD_HHMMSS/
  video.mp4
  poses.jsonl
  snaps.jsonl
  snaps/snap_001.jpg
  manifest.json          # primary: "snaps"
```

## Requirements

- [ARCore-supported phone](https://developers.google.com/ar/devices)
- JDK 17, Android SDK, Google Play Services for AR

## Build & install

```powershell
cd apps\capture-android
# local.properties → sdk.dir=C:\\Users\\YOU\\AppData\\Local\\Android\\Sdk
.\gradlew.bat :app:installDebug
```

## Walk

1. Wait until status shows tracking (surfaces optional for START).
2. **START** — video + poses run in the background.
3. Toggle Exterior / Interior / Door, then **SNAP** at each important view.
4. **STOP** → `adb pull` → `npm run ingest:capture -- <folder>`.

See [docs/capture-android.md](../../docs/capture-android.md).
