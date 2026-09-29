/*
 * p2D capture session writer — snap-first nodes for Blender, video + poses as fill.
 */
package local.p2d.capture;

import android.graphics.ImageFormat;
import android.graphics.Rect;
import android.graphics.YuvImage;
import android.media.Image;
import android.os.Build;
import android.util.Log;
import com.google.ar.core.Camera;
import com.google.ar.core.CameraIntrinsics;
import com.google.ar.core.Frame;
import com.google.ar.core.Pose;
import com.google.ar.core.TrackingState;
import com.google.ar.core.exceptions.NotYetAvailableException;
import java.io.BufferedWriter;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileWriter;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.util.Locale;

/**
 * Capture package for Blender / labeler:
 *
 * <pre>
 * capture_YYYYMMDD_HHMMSS/
 *   video.mp4              # continuous AR video (fill / texture)
 *   poses.jsonl            # dense trajectory (fill / stitching)
 *   snaps.jsonl            # PRIMARY nodes — one intentional still each
 *   snaps/snap_001.jpg
 *   manifest.json
 * </pre>
 */
public final class CaptureSessionWriter implements AutoCloseable {
  private static final String TAG = "P2DCaptureWriter";

  private final File captureDir;
  private final File snapsDir;
  private final BufferedWriter posesOut;
  private final BufferedWriter snapsOut;
  private final BufferedWriter readyOut;
  private final String startedAtIso;
  private final long startElapsedRealtimeNs;
  private int frameIndex = 0;
  private int poseCount = 0;
  private int snapCount = 0;
  private int readyEventCount = 0;
  private float[] fxFyCxCy = null;
  private int imageWidth = 0;
  private int imageHeight = 0;
  private String cameraConfigLabel = "default";

  public CaptureSessionWriter(File captureDir) throws IOException {
    this.captureDir = captureDir;
    if (!captureDir.exists() && !captureDir.mkdirs()) {
      throw new IOException("Cannot create capture dir: " + captureDir);
    }
    this.snapsDir = new File(captureDir, "snaps");
    if (!snapsDir.exists() && !snapsDir.mkdirs()) {
      throw new IOException("Cannot create snaps dir: " + snapsDir);
    }
    this.posesOut =
        new BufferedWriter(new FileWriter(new File(captureDir, "poses.jsonl"), false));
    this.snapsOut =
        new BufferedWriter(new FileWriter(new File(captureDir, "snaps.jsonl"), false));
    this.readyOut =
        new BufferedWriter(new FileWriter(new File(captureDir, "ready.jsonl"), false));
    this.startedAtIso = java.time.Instant.now().toString();
    this.startElapsedRealtimeNs = System.nanoTime();
  }

  public File getCaptureDir() {
    return captureDir;
  }

  public File getVideoFile() {
    return new File(captureDir, "video.mp4");
  }

  public void setCameraConfigLabel(String label) {
    if (label != null && !label.isEmpty()) {
      this.cameraConfigLabel = label;
    }
  }

  public void setExpectedImageSize(int width, int height) {
    if (width > 0 && height > 0) {
      this.imageWidth = width;
      this.imageHeight = height;
    }
  }

  public int getSnapCount() {
    return snapCount;
  }

  /**
   * Log UI ready-state transitions (green frame moments) for offline recovery / debugging.
   */
  public synchronized void appendReadyEvent(
      long tNs,
      String state,
      int featureCount,
      boolean autoEnabled,
      String reason,
      float[] posM,
      double yawDeg) {
    try {
      String pos =
          posM == null || posM.length < 3
              ? "null"
              : String.format(
                  Locale.US, "[%.6f,%.6f,%.6f]", posM[0], posM[1], posM[2]);
      String line =
          String.format(
              Locale.US,
              "{\"t_ns\":%d,\"frame\":%d,\"state\":\"%s\",\"features\":%d,\"auto\":%s,\"yaw_deg\":%.2f,\"pos_m\":%s,\"reason\":%s}",
              tNs,
              Math.max(0, frameIndex - 1),
              escape(state),
              featureCount,
              autoEnabled ? "true" : "false",
              yawDeg,
              pos,
              jsonStr(reason == null ? "" : reason));
      readyOut.write(line);
      readyOut.newLine();
      readyEventCount++;
      if (readyEventCount % 10 == 0) {
        readyOut.flush();
      }
    } catch (IOException e) {
      Log.e(TAG, "Failed to write ready event", e);
    }
  }

  /** Append one trajectory sample (fill data for stitching). */
  public synchronized void appendPose(Frame frame, Camera camera, String facing) {
    if (camera == null) {
      return;
    }
    try {
      ensureIntrinsics(camera);
      Pose pose = camera.getDisplayOrientedPose();
      float[] t = pose.getTranslation();
      float[] q = pose.getRotationQuaternion();
      TrackingState state = camera.getTrackingState();
      long tNs = frame.getTimestamp();

      String line =
          String.format(
              Locale.US,
              "{\"t_ns\":%d,\"frame\":%d,\"pos_m\":[%.6f,%.6f,%.6f],\"quat_xyzw\":[%.6f,%.6f,%.6f,%.6f],\"facing\":%s,\"tracking\":\"%s\"}",
              tNs,
              frameIndex,
              t[0],
              t[1],
              t[2],
              q[0],
              q[1],
              q[2],
              q[3],
              jsonStr(facing),
              state.name());
      posesOut.write(line);
      posesOut.newLine();
      poseCount++;
      frameIndex++;
      if (poseCount % 30 == 0) {
        posesOut.flush();
      }
    } catch (IOException e) {
      Log.e(TAG, "Failed to write pose", e);
    }
  }

  /**
   * Capture a PRIMARY node: still JPEG + metric pose + semantic tags.
   *
   * @return snap id or null on failure
   */
  public synchronized String takeSnap(
      Frame frame,
      Camera camera,
      String facing,
      String locationType,
      String note) {
    if (camera == null || frame == null) {
      return null;
    }
    if (camera.getTrackingState() != TrackingState.TRACKING) {
      Log.w(TAG, "Snap refused: tracking not TRACKING");
      return null;
    }
    try {
      ensureIntrinsics(camera);
      int index = snapCount + 1;
      String id = String.format(Locale.US, "snap_%03d", index);
      String relImage = "snaps/" + id + ".jpg";
      File jpegFile = new File(captureDir, relImage);

      int[] jpegSize = new int[2];
      if (!saveFrameJpeg(frame, jpegFile, jpegSize)) {
        Log.e(TAG, "Snap JPEG encode failed");
        return null;
      }

      Pose pose = camera.getDisplayOrientedPose();
      float[] t = pose.getTranslation();
      float[] q = pose.getRotationQuaternion();
      long tNs = frame.getTimestamp();
      int frameNo = Math.max(0, frameIndex - 1);

      String line =
          String.format(
              Locale.US,
              "{\"id\":\"%s\",\"t_ns\":%d,\"frame\":%d,\"pos_m\":[%.6f,%.6f,%.6f],\"quat_xyzw\":[%.6f,%.6f,%.6f,%.6f],\"facing\":%s,\"tracking\":\"TRACKING\",\"location_type\":%s,\"note\":%s,\"image\":\"%s\",\"image_width\":%d,\"image_height\":%d,\"role\":\"node\"}",
              id,
              tNs,
              frameNo,
              t[0],
              t[1],
              t[2],
              q[0],
              q[1],
              q[2],
              q[3],
              jsonStr(facing),
              jsonStr(locationType),
              jsonStr(note == null ? "" : note),
              relImage,
              jpegSize[0],
              jpegSize[1]);
      snapsOut.write(line);
      snapsOut.newLine();
      snapsOut.flush();
      snapCount++;
      return id;
    } catch (IOException e) {
      Log.e(TAG, "Failed to write snap", e);
      return null;
    }
  }

  public synchronized void finish(String arcoreVersionHint) throws IOException {
    posesOut.flush();
    snapsOut.flush();
    readyOut.flush();
    long durationMs = (System.nanoTime() - startElapsedRealtimeNs) / 1_000_000L;
    String fx = fxFyCxCy == null ? "0" : String.format(Locale.US, "%.4f", fxFyCxCy[0]);
    String fy = fxFyCxCy == null ? "0" : String.format(Locale.US, "%.4f", fxFyCxCy[1]);
    String cx = fxFyCxCy == null ? "0" : String.format(Locale.US, "%.4f", fxFyCxCy[2]);
    String cy = fxFyCxCy == null ? "0" : String.format(Locale.US, "%.4f", fxFyCxCy[3]);
    String json =
        "{\n"
            + "  \"format\": \"p2d.capture\",\n"
            + "  \"version\": 2,\n"
            + "  \"units\": \"m\",\n"
            + "  \"primary\": \"snaps\",\n"
            + "  \"started_at\": \""
            + startedAtIso
            + "\",\n"
            + "  \"ended_at\": \""
            + java.time.Instant.now().toString()
            + "\",\n"
            + "  \"duration_ms\": "
            + durationMs
            + ",\n"
            + "  \"pose_count\": "
            + poseCount
            + ",\n"
            + "  \"snap_count\": "
            + snapCount
            + ",\n"
            + "  \"ready_event_count\": "
            + readyEventCount
            + ",\n"
            + "  \"video\": \"video.mp4\",\n"
            + "  \"poses\": \"poses.jsonl\",\n"
            + "  \"snaps\": \"snaps.jsonl\",\n"
            + "  \"ready\": \"ready.jsonl\",\n"
            + "  \"snaps_dir\": \"snaps\",\n"
            + "  \"device\": {\n"
            + "    \"manufacturer\": \""
            + escape(Build.MANUFACTURER)
            + "\",\n"
            + "    \"model\": \""
            + escape(Build.MODEL)
            + "\",\n"
            + "    \"android_sdk\": "
            + Build.VERSION.SDK_INT
            + "\n"
            + "  },\n"
            + "  \"camera\": {\n"
            + "    \"image_width\": "
            + imageWidth
            + ",\n"
            + "    \"image_height\": "
            + imageHeight
            + ",\n"
            + "    \"fx\": "
            + fx
            + ",\n"
            + "    \"fy\": "
            + fy
            + ",\n"
            + "    \"cx\": "
            + cx
            + ",\n"
            + "    \"cy\": "
            + cy
            + ",\n"
            + "    \"config\": \""
            + escape(cameraConfigLabel)
            + "\"\n"
            + "  },\n"
            + "  \"arcore\": \""
            + escape(arcoreVersionHint == null ? "unknown" : arcoreVersionHint)
            + "\",\n"
            + "  \"coord_system\": \"arcore_display_oriented\",\n"
            + "  \"notes\": \"Snaps are primary Blender/labeler nodes. Video+poses.jsonl are fill for trajectory and texture.\"\n"
            + "}\n";
    try (FileWriter fw = new FileWriter(new File(captureDir, "manifest.json"))) {
      fw.write(json);
    }
  }

  @Override
  public void close() throws IOException {
    try {
      posesOut.close();
    } finally {
      try {
        snapsOut.close();
      } finally {
        readyOut.close();
      }
    }
  }

  private void ensureIntrinsics(Camera camera) {
    if (fxFyCxCy != null) {
      return;
    }
    try {
      CameraIntrinsics intrinsics = camera.getImageIntrinsics();
      float[] f = intrinsics.getFocalLength();
      float[] pp = intrinsics.getPrincipalPoint();
      int[] size = intrinsics.getImageDimensions();
      fxFyCxCy = new float[] {f[0], f[1], pp[0], pp[1]};
      imageWidth = size[0];
      imageHeight = size[1];
    } catch (Throwable t) {
      Log.w(TAG, "Intrinsics unavailable", t);
      fxFyCxCy = new float[] {0, 0, 0, 0};
    }
  }

  /** Encode ARCore CPU image (YUV_420_888) to JPEG. Writes width/height into outSize[0/1]. */
  private static boolean saveFrameJpeg(Frame frame, File outFile, int[] outSize) {
    Image image = null;
    try {
      image = frame.acquireCameraImage();
      if (image.getFormat() != ImageFormat.YUV_420_888) {
        Log.e(TAG, "Unexpected image format " + image.getFormat());
        return false;
      }
      int w = image.getWidth();
      int h = image.getHeight();
      byte[] nv21 = yuv420888ToNv21(image);
      YuvImage yuv = new YuvImage(nv21, ImageFormat.NV21, w, h, null);
      ByteArrayOutputStream baos = new ByteArrayOutputStream();
      yuv.compressToJpeg(new Rect(0, 0, w, h), 92, baos);
      try (FileOutputStream fos = new FileOutputStream(outFile)) {
        fos.write(baos.toByteArray());
      }
      if (outSize != null && outSize.length >= 2) {
        outSize[0] = w;
        outSize[1] = h;
      }
      return true;
    } catch (NotYetAvailableException e) {
      Log.w(TAG, "Camera image not yet available", e);
      return false;
    } catch (IOException e) {
      Log.e(TAG, "JPEG write failed", e);
      return false;
    } finally {
      if (image != null) {
        image.close();
      }
    }
  }

  private static byte[] yuv420888ToNv21(Image image) {
    int width = image.getWidth();
    int height = image.getHeight();
    Image.Plane yPlane = image.getPlanes()[0];
    Image.Plane uPlane = image.getPlanes()[1];
    Image.Plane vPlane = image.getPlanes()[2];

    ByteBuffer yBuffer = yPlane.getBuffer();
    ByteBuffer uBuffer = uPlane.getBuffer();
    ByteBuffer vBuffer = vPlane.getBuffer();

    int yRowStride = yPlane.getRowStride();
    int uvRowStride = uPlane.getRowStride();
    int uvPixelStride = uPlane.getPixelStride();

    byte[] nv21 = new byte[width * height + (width * height) / 2];
    int pos = 0;
    for (int row = 0; row < height; row++) {
      int yPos = row * yRowStride;
      for (int col = 0; col < width; col++) {
        nv21[pos++] = yBuffer.get(yPos + col);
      }
    }
    int uvHeight = height / 2;
    int uvWidth = width / 2;
    for (int row = 0; row < uvHeight; row++) {
      for (int col = 0; col < uvWidth; col++) {
        int uvIndex = row * uvRowStride + col * uvPixelStride;
        nv21[pos++] = vBuffer.get(uvIndex);
        nv21[pos++] = uBuffer.get(uvIndex);
      }
    }
    return nv21;
  }

  private static String jsonStr(String s) {
    if (s == null) {
      return "null";
    }
    return "\"" + escape(s) + "\"";
  }

  private static String escape(String s) {
    return s.replace("\\", "\\\\").replace("\"", "\\\"");
  }

  public static String facingFromYawDeg(double yawDeg) {
    double y = ((yawDeg % 360) + 360) % 360;
    if (y >= 337.5 || y < 22.5) return "N";
    if (y < 67.5) return "NE";
    if (y < 112.5) return "E";
    if (y < 157.5) return "SE";
    if (y < 202.5) return "S";
    if (y < 247.5) return "SW";
    if (y < 292.5) return "W";
    return "NW";
  }

  public static double yawDegFromPose(Pose pose) {
    float[] forward = new float[3];
    pose.getTransformedAxis(2, -1.0f, forward, 0);
    return Math.toDegrees(Math.atan2(forward[0], -forward[2]));
  }
}
