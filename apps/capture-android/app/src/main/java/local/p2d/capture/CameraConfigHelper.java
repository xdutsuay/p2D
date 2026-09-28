package local.p2d.capture;

import android.util.Log;
import android.util.Size;
import com.google.ar.core.CameraConfig;
import com.google.ar.core.CameraConfigFilter;
import com.google.ar.core.Session;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.EnumSet;
import java.util.List;

/**
 * ARCore camera configs: keep VGA (or lowest CPU) for smooth tracking, switch to highest CPU only
 * for SNAP stills.
 */
public final class CameraConfigHelper {
  private static final String TAG = "P2DCamConfig";

  public static final class Selection {
    public final CameraConfig config;
    public final Size cpuSize;
    public final Size textureSize;
    public final String label;

    Selection(CameraConfig config, Size cpuSize, Size textureSize, String label) {
      this.config = config;
      this.cpuSize = cpuSize;
      this.textureSize = textureSize;
      this.label = label;
    }

    public long pixelCount() {
      return (long) cpuSize.getWidth() * cpuSize.getHeight();
    }
  }

  public static final class Pair {
    public final Selection tracking; // low / smooth
    public final Selection snap; // high / stills

    Pair(Selection tracking, Selection snap) {
      this.tracking = tracking;
      this.snap = snap;
    }

    public boolean canSwitchForSnap() {
      return tracking != null
          && snap != null
          && tracking.config != null
          && snap.config != null
          && snap.pixelCount() > tracking.pixelCount();
    }
  }

  private CameraConfigHelper() {}

  public static Pair selectTrackingAndSnap(Session session) {
    List<CameraConfig> configs = listConfigs(session);
    if (configs.isEmpty()) {
      CameraConfig current = session.getCameraConfig();
      Size cpu = current.getImageSize();
      Selection one =
          new Selection(current, cpu, current.getTextureSize(), sizeLabel(cpu));
      return new Pair(one, one);
    }

    Collections.sort(
        configs,
        new Comparator<CameraConfig>() {
          @Override
          public int compare(CameraConfig a, CameraConfig b) {
            return Long.compare(pixels(a), pixels(b)); // ascending
          }
        });

    for (CameraConfig c : configs) {
      Size cpu = c.getImageSize();
      Log.i(TAG, "avail cpu=" + sizeLabel(cpu) + " tex=" + sizeLabel(c.getTextureSize()));
    }

    CameraConfig lowCfg = configs.get(0);
    CameraConfig highCfg = configs.get(configs.size() - 1);
    Selection low =
        new Selection(lowCfg, lowCfg.getImageSize(), lowCfg.getTextureSize(), sizeLabel(lowCfg.getImageSize()));
    Selection high =
        new Selection(
            highCfg, highCfg.getImageSize(), highCfg.getTextureSize(), sizeLabel(highCfg.getImageSize()));
    Log.i(TAG, "tracking=" + low.label + " snap=" + high.label);
    return new Pair(low, high);
  }

  /** @deprecated use {@link #selectTrackingAndSnap(Session)} */
  public static Selection selectHighestCpu(Session session) {
    return selectTrackingAndSnap(session).snap;
  }

  public static void apply(Session session, Selection selection) {
    if (selection == null || selection.config == null) {
      return;
    }
    session.setCameraConfig(selection.config);
  }

  private static List<CameraConfig> listConfigs(Session session) {
    CameraConfigFilter filter =
        new CameraConfigFilter(session)
            .setTargetFps(EnumSet.of(CameraConfig.TargetFps.TARGET_FPS_30));
    List<CameraConfig> configs = session.getSupportedCameraConfigs(filter);
    if (configs == null || configs.isEmpty()) {
      configs = session.getSupportedCameraConfigs(new CameraConfigFilter(session));
    }
    return configs == null ? new ArrayList<CameraConfig>() : new ArrayList<CameraConfig>(configs);
  }

  private static long pixels(CameraConfig c) {
    Size s = c.getImageSize();
    return (long) s.getWidth() * s.getHeight();
  }

  private static String sizeLabel(Size s) {
    return s.getWidth() + "x" + s.getHeight();
  }
}
