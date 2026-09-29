/*
 * Snap readiness, retry, autosnap spacing, and near-duplicate detection.
 */
package local.p2d.capture;

import com.google.ar.core.Pose;
import com.google.ar.core.TrackingState;
import java.util.ArrayList;
import java.util.List;

/** Pure logic for when SNAP should light up / fire. */
public final class SnapAssistant {
  public enum ReadyState {
    IDLE,
    HUNTING,
    READY,
    DUPLICATE,
    SNAPPING
  }

  /** Min confident feature points for a "locked" view. */
  public static final int MIN_FEATURES = 8;
  /** Frames to keep trying after a SNAP tap (~1s at 30fps). */
  public static final int RETRY_FRAMES = 30;
  /**
   * Rolling window for autosnap (Samsung tracking flickers every few frames — consecutive
   * streaks rarely hit 8).
   */
  public static final int READY_WINDOW = 10;
  /** Need this many ready hits inside the window before autosnap. */
  public static final int AUTO_READY_HITS = 3;
  /** Near-duplicate: same place + facing. */
  public static final float DUP_DIST_M = 0.35f;
  public static final float DUP_YAW_DEG = 22f;
  /** Autosnap spacing — tighter so walks produce more nodes. */
  public static final float AUTO_DIST_M = 0.45f;
  public static final float AUTO_YAW_DEG = 22f;
  /** Min gap between autosnaps (ms) so encode/UI can breathe. */
  public static final long AUTO_MIN_INTERVAL_MS = 700;

  public static final class SnapPose {
    public final float x;
    public final float y;
    public final float z;
    public final double yawDeg;

    public SnapPose(float x, float y, float z, double yawDeg) {
      this.x = x;
      this.y = y;
      this.z = z;
      this.yawDeg = yawDeg;
    }

    public static SnapPose from(Pose pose) {
      float[] t = pose.getTranslation();
      return new SnapPose(t[0], t[1], t[2], CaptureSessionWriter.yawDegFromPose(pose));
    }
  }

  private final List<SnapPose> snaps = new ArrayList<>();
  private final boolean[] readyWindow = new boolean[READY_WINDOW];
  private int readyWindowIdx = 0;
  private int readyWindowFilled = 0;
  private int retryFramesLeft = 0;
  private boolean forceDuplicate = false;
  /** Default ON — walk and collect nodes. */
  private boolean autoEnabled = true;
  private ReadyState state = ReadyState.IDLE;
  private ReadyState prevLoggedState = ReadyState.IDLE;
  private String reason = "";
  private int lastFeatureCount = 0;
  private boolean lastTracking = false;
  private SnapPose lastCameraPose = null;
  private long lastAutoSnapElapsedMs = 0;
  private boolean justBecameReady = false;

  public void resetSession() {
    snaps.clear();
    for (int i = 0; i < readyWindow.length; i++) {
      readyWindow[i] = false;
    }
    readyWindowIdx = 0;
    readyWindowFilled = 0;
    retryFramesLeft = 0;
    forceDuplicate = false;
    state = ReadyState.IDLE;
    prevLoggedState = ReadyState.IDLE;
    reason = "";
    lastFeatureCount = 0;
    lastTracking = false;
    lastCameraPose = null;
    lastAutoSnapElapsedMs = 0;
    justBecameReady = false;
  }

  public void setAutoEnabled(boolean enabled) {
    autoEnabled = enabled;
    if (!enabled) {
      clearReadyWindow();
    }
  }

  public boolean isAutoEnabled() {
    return autoEnabled;
  }

  public ReadyState getState() {
    return state;
  }

  public String getReason() {
    return reason;
  }

  public int getFeatureCount() {
    return lastFeatureCount;
  }

  public boolean isTracking() {
    return lastTracking;
  }

  public boolean isSnapReady() {
    return state == ReadyState.READY || state == ReadyState.DUPLICATE;
  }

  public boolean isRetrying() {
    return retryFramesLeft > 0;
  }

  /** True for one frame after transitioning into READY (for haptic). */
  public boolean consumeJustBecameReady() {
    boolean v = justBecameReady;
    justBecameReady = false;
    return v;
  }

  /** True when ready-state changed (for ready.jsonl). */
  public boolean stateChangedForLog() {
    if (state != prevLoggedState) {
      prevLoggedState = state;
      return true;
    }
    return false;
  }

  /** User tapped SNAP — begin retry window. */
  public void requestManualSnap() {
    retryFramesLeft = RETRY_FRAMES;
    state = ReadyState.SNAPPING;
    reason = "Acquiring lock…";
  }

  /** Second tap soon after duplicate warning. */
  public void forceNextDuplicate() {
    forceDuplicate = true;
  }

  public void cancelRetry() {
    retryFramesLeft = 0;
    if (state == ReadyState.SNAPPING) {
      state = ReadyState.HUNTING;
      reason = "Snap cancelled";
    }
  }

  public void recordSuccessfulSnap(SnapPose pose) {
    if (pose != null) {
      snaps.add(pose);
    }
    retryFramesLeft = 0;
    forceDuplicate = false;
    clearReadyWindow();
    lastAutoSnapElapsedMs = android.os.SystemClock.elapsedRealtime();
  }

  /**
   * Update per frame. Returns true if a snap should be attempted on this frame (manual retry or
   * autosnap).
   */
  public boolean updateFrame(
      TrackingState trackingState, int featureCount, Pose cameraPose, String trackingFailReason) {
    lastFeatureCount = featureCount;
    lastTracking = trackingState == TrackingState.TRACKING;
    lastCameraPose = cameraPose != null ? SnapPose.from(cameraPose) : null;

    boolean trackingOk = lastTracking;
    boolean featuresOk = featureCount >= MIN_FEATURES;
    boolean viewOk = trackingOk && featuresOk;

    pushReady(viewOk);

    SnapPose dup = viewOk ? findNearDuplicate(lastCameraPose) : null;
    boolean isDup = dup != null;

    if (retryFramesLeft > 0) {
      state = ReadyState.SNAPPING;
      if (!trackingOk) {
        reason =
            trackingFailReason != null && !trackingFailReason.isEmpty()
                ? trackingFailReason
                : "Waiting for TRACKING…";
        retryFramesLeft--;
        if (retryFramesLeft <= 0) {
          state = ReadyState.HUNTING;
          reason = "Snap failed — no lock";
        }
        return false;
      }
      if (isDup && !forceDuplicate) {
        reason = "Already snapped this view — tap SNAP again to force";
        state = ReadyState.DUPLICATE;
        retryFramesLeft = 0;
        return false;
      }
      reason = "Snapping…";
      retryFramesLeft = 0;
      return true;
    }

    if (!trackingOk) {
      state = ReadyState.HUNTING;
      reason =
          trackingFailReason != null && !trackingFailReason.isEmpty()
              ? trackingFailReason
              : "Aim at textured surfaces";
      return false;
    }

    if (!featuresOk) {
      state = ReadyState.HUNTING;
      reason = "Need more detail (" + featureCount + " pts)";
      return false;
    }

    if (isDup && !forceDuplicate) {
      state = ReadyState.DUPLICATE;
      reason = "Already snapped — move or tap again to force";
      return false;
    }

    ReadyState before = state;
    state = ReadyState.READY;
    reason = autoEnabled ? "Ready — AUTO" : "Ready — SNAP";
    if (before != ReadyState.READY) {
      justBecameReady = true;
    }

    if (autoEnabled && readyHits() >= AUTO_READY_HITS && movedEnoughForAuto(lastCameraPose)) {
      long now = android.os.SystemClock.elapsedRealtime();
      if (now - lastAutoSnapElapsedMs >= AUTO_MIN_INTERVAL_MS) {
        reason = "Autosnap…";
        state = ReadyState.SNAPPING;
        return true;
      }
      reason = "Ready — spacing…";
    }
    return false;
  }

  private void pushReady(boolean ready) {
    readyWindow[readyWindowIdx] = ready;
    readyWindowIdx = (readyWindowIdx + 1) % READY_WINDOW;
    if (readyWindowFilled < READY_WINDOW) {
      readyWindowFilled++;
    }
  }

  private int readyHits() {
    int n = 0;
    int limit = readyWindowFilled;
    for (int i = 0; i < limit; i++) {
      if (readyWindow[i]) {
        n++;
      }
    }
    return n;
  }

  private void clearReadyWindow() {
    for (int i = 0; i < readyWindow.length; i++) {
      readyWindow[i] = false;
    }
    readyWindowIdx = 0;
    readyWindowFilled = 0;
  }

  private SnapPose findNearDuplicate(SnapPose pose) {
    if (pose == null) {
      return null;
    }
    for (SnapPose s : snaps) {
      if (distanceM(pose, s) <= DUP_DIST_M && yawDeltaDeg(pose.yawDeg, s.yawDeg) <= DUP_YAW_DEG) {
        return s;
      }
    }
    return null;
  }

  private boolean movedEnoughForAuto(SnapPose pose) {
    if (pose == null) {
      return false;
    }
    if (snaps.isEmpty()) {
      return true;
    }
    SnapPose last = snaps.get(snaps.size() - 1);
    return distanceM(pose, last) >= AUTO_DIST_M
        || yawDeltaDeg(pose.yawDeg, last.yawDeg) >= AUTO_YAW_DEG;
  }

  public static float distanceM(SnapPose a, SnapPose b) {
    float dx = a.x - b.x;
    float dy = a.y - b.y;
    float dz = a.z - b.z;
    return (float) Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  public static double yawDeltaDeg(double a, double b) {
    double d = Math.abs(a - b) % 360.0;
    if (d > 180.0) {
      d = 360.0 - d;
    }
    return d;
  }
}
