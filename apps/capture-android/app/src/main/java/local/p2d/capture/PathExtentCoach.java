/*
 * Deterministic walk-extent coaching (no LLM) — catches AR drift / sparse coverage early.
 */
package local.p2d.capture;

import java.util.Locale;

/** Tracks pose AABB while recording and suggests coverage / drift tips. */
public final class PathExtentCoach {
  /** Typical single-storey footprint diagonal order-of-magnitude. */
  public static final float WARN_EXTENT_M = 28f;
  public static final float BAD_EXTENT_M = 45f;

  private float minX = Float.POSITIVE_INFINITY;
  private float minY = Float.POSITIVE_INFINITY;
  private float minZ = Float.POSITIVE_INFINITY;
  private float maxX = Float.NEGATIVE_INFINITY;
  private float maxY = Float.NEGATIVE_INFINITY;
  private float maxZ = Float.NEGATIVE_INFINITY;
  private int sampleCount = 0;
  private int snapCount = 0;
  private long trackingLostMs = 0;
  private long lastLostStartMs = 0;
  private boolean wasTracking = true;

  public void reset() {
    minX = minY = minZ = Float.POSITIVE_INFINITY;
    maxX = maxY = maxZ = Float.NEGATIVE_INFINITY;
    sampleCount = 0;
    snapCount = 0;
    trackingLostMs = 0;
    lastLostStartMs = 0;
    wasTracking = true;
    hasLast = false;
  }

  /** Ignore teleport jumps so one bad pose cannot explode extent to km+. */
  public static final float MAX_STEP_M = 2.0f;

  private float lastX;
  private float lastY;
  private float lastZ;
  private boolean hasLast = false;

  public void onPose(float x, float y, float z, boolean tracking) {
    long now = android.os.SystemClock.elapsedRealtime();
    if (!tracking) {
      if (wasTracking) {
        lastLostStartMs = now;
      }
      wasTracking = false;
      hasLast = false;
      return;
    }
    if (!wasTracking && lastLostStartMs > 0) {
      trackingLostMs += now - lastLostStartMs;
      lastLostStartMs = 0;
    }
    wasTracking = true;
    if (hasLast) {
      float dx = x - lastX;
      float dy = y - lastY;
      float dz = z - lastZ;
      float step = (float) Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (step > MAX_STEP_M) {
        // Relocalize — start a new AABB seed without poisoning the global box.
        hasLast = true;
        lastX = x;
        lastY = y;
        lastZ = z;
        return;
      }
    }
    hasLast = true;
    lastX = x;
    lastY = y;
    lastZ = z;
    sampleCount++;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }

  public void onSnap() {
    snapCount++;
  }

  /** Horizontal-ish extent using XZ (ARCore display Y is up). */
  public float extentM() {
    if (sampleCount < 2) {
      return 0f;
    }
    float dx = maxX - minX;
    float dz = maxZ - minZ;
    return (float) Math.sqrt(dx * dx + dz * dz);
  }

  public int getSnapCount() {
    return snapCount;
  }

  public String hint() {
    float e = extentM();
    if (sampleCount < 30) {
      return snapCount == 0 ? "Walk slowly; wait for green before first snap" : "Keep collecting corners and doors";
    }
    if (e >= BAD_EXTENT_M) {
      return String.format(
          Locale.US,
          "Path ~%.0fm — tracking likely drifted; re-walk a known corner",
          e);
    }
    if (e >= WARN_EXTENT_M) {
      return String.format(
          Locale.US, "Path ~%.0fm growing large — revisit a doorway to check scale", e);
    }
    if (snapCount > 0 && e > 8f && snapCount < 6) {
      return "Sparse snaps for this walk — hit doors and room corners";
    }
    if (trackingLostMs > 8000) {
      return "Tracking dropped often — add light / textured surfaces";
    }
    if (snapCount >= 3 && e < 2.5f) {
      return "Still near start — cover more of the floor plan";
    }
    return String.format(Locale.US, "Path ~%.1fm · %d snaps", e, snapCount);
  }
}
