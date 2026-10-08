/*
 * Live OpenRouter vision assist during capture — labels + coaching tips, not geometry.
 */
package local.p2d.capture;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;
import android.util.Log;
import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONArray;
import org.json.JSONObject;

/** Queued vision calls to OpenRouter after snaps. Rate-limited; never blocks the GL thread. */
public final class LiveAssistClient {
  private static final String TAG = "P2DLiveAssist";
  private static final String PREFS = "p2d_live_assist";
  private static final String KEY_API = "openrouter_api_key";
  private static final String KEY_ENABLED = "assist_enabled";
  private static final String KEY_MODEL = "openrouter_model";
  private static final String DEFAULT_MODEL = "openrouter/auto";
  private static final String ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
  private static final long MIN_INTERVAL_MS = 3500;
  private static final int MAX_EDGE_PX = 512;
  private static final int JPEG_QUALITY = 72;

  public static final class Result {
    public final String snapId;
    public final String roomGuess;
    public final String locationType;
    public final String shows;
    public final String tip;
    public final String model;
    public final String rawError;
    public final long latencyMs;

    public Result(
        String snapId,
        String roomGuess,
        String locationType,
        String shows,
        String tip,
        String model,
        String rawError,
        long latencyMs) {
      this.snapId = snapId;
      this.roomGuess = roomGuess;
      this.locationType = locationType;
      this.shows = shows;
      this.tip = tip;
      this.model = model;
      this.rawError = rawError;
      this.latencyMs = latencyMs;
    }

    public boolean ok() {
      return rawError == null || rawError.isEmpty();
    }

    public String shortTip() {
      if (!ok()) {
        return "Assist: " + rawError;
      }
      StringBuilder sb = new StringBuilder();
      if (roomGuess != null && !roomGuess.isEmpty()) {
        sb.append(roomGuess);
      }
      if (tip != null && !tip.isEmpty()) {
        if (sb.length() > 0) {
          sb.append(" — ");
        }
        sb.append(tip);
      }
      if (sb.length() == 0) {
        sb.append("labeled");
      }
      return sb.toString();
    }
  }

  public interface Listener {
    void onAssistResult(Result result);
  }

  private final SharedPreferences prefs;
  private final String buildConfigKey;
  private final String buildConfigModel;
  private final ExecutorService executor = Executors.newSingleThreadExecutor();
  private final AtomicBoolean busy = new AtomicBoolean(false);
  private final AtomicLong lastRequestMs = new AtomicLong(0);
  private final AtomicReference<Pending> pending = new AtomicReference<>(null);
  private volatile Listener listener;

  private static final class Pending {
    final String snapId;
    final File jpeg;
    final String facing;
    final String locationType;
    final int snapCount;
    final float pathExtentM;
    final String coachHint;

    Pending(
        String snapId,
        File jpeg,
        String facing,
        String locationType,
        int snapCount,
        float pathExtentM,
        String coachHint) {
      this.snapId = snapId;
      this.jpeg = jpeg;
      this.facing = facing;
      this.locationType = locationType;
      this.snapCount = snapCount;
      this.pathExtentM = pathExtentM;
      this.coachHint = coachHint;
    }
  }

  public LiveAssistClient(Context context, String buildConfigKey, String buildConfigModel) {
    this.prefs = context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    this.buildConfigKey = buildConfigKey == null ? "" : buildConfigKey.trim();
    this.buildConfigModel =
        buildConfigModel == null || buildConfigModel.isEmpty() ? DEFAULT_MODEL : buildConfigModel;
  }

  public void setListener(Listener listener) {
    this.listener = listener;
  }

  public boolean isEnabled() {
    return prefs.getBoolean(KEY_ENABLED, true) && hasApiKey();
  }

  public boolean wantsEnabled() {
    return prefs.getBoolean(KEY_ENABLED, true);
  }

  public void setEnabled(boolean enabled) {
    prefs.edit().putBoolean(KEY_ENABLED, enabled).apply();
  }

  public boolean hasApiKey() {
    String k = getApiKey();
    return k != null && !k.isEmpty();
  }

  public String getApiKey() {
    String stored = prefs.getString(KEY_API, "");
    if (stored != null && !stored.trim().isEmpty()) {
      return stored.trim();
    }
    return buildConfigKey;
  }

  public void setApiKey(String key) {
    if (key == null) {
      key = "";
    }
    prefs.edit().putString(KEY_API, key.trim()).apply();
  }

  public String getModel() {
    String m = prefs.getString(KEY_MODEL, "");
    if (m == null || m.trim().isEmpty()) {
      m = buildConfigModel;
    }
    return normalizeModel(m);
  }

  /** Map friendly "auto" to OpenRouter's router id. */
  static String normalizeModel(String model) {
    if (model == null) {
      return DEFAULT_MODEL;
    }
    String m = model.trim();
    if (m.isEmpty() || m.equalsIgnoreCase("auto") || m.equalsIgnoreCase("openrouter-auto")) {
      return "openrouter/auto";
    }
    return m;
  }

  public void setModel(String model) {
    if (model == null || model.trim().isEmpty()) {
      prefs.edit().remove(KEY_MODEL).apply();
    } else {
      prefs.edit().putString(KEY_MODEL, model.trim()).apply();
    }
  }

  public String statusLabel() {
    if (!wantsEnabled()) {
      return "AI off";
    }
    if (!hasApiKey()) {
      return "AI needs key";
    }
    return "AI on";
  }

  public void shutdown() {
    executor.shutdownNow();
  }

  /**
   * Queue a vision label for a saved snap JPEG. Coalesces to the latest snap while a request is
   * in-flight or within the rate-limit window.
   */
  public void enqueueSnapAssist(
      String snapId,
      File jpegFile,
      String facing,
      String locationType,
      int snapCount,
      float pathExtentM,
      String coachHint) {
    if (!isEnabled() || jpegFile == null || !jpegFile.isFile()) {
      return;
    }
    pending.set(
        new Pending(snapId, jpegFile, facing, locationType, snapCount, pathExtentM, coachHint));
    maybePump();
  }

  private void maybePump() {
    executor.execute(
        () -> {
          Pending job = pending.getAndSet(null);
          if (job == null) {
            return;
          }
          long now = System.currentTimeMillis();
          long since = now - lastRequestMs.get();
          if (since < MIN_INTERVAL_MS) {
            // Keep newest; retry after remaining wait.
            Pending newer = pending.get();
            if (newer == null) {
              pending.compareAndSet(null, job);
            }
            try {
              Thread.sleep(MIN_INTERVAL_MS - since);
            } catch (InterruptedException e) {
              Thread.currentThread().interrupt();
              return;
            }
            maybePump();
            return;
          }
          if (!busy.compareAndSet(false, true)) {
            Pending newer = pending.get();
            if (newer == null) {
              pending.compareAndSet(null, job);
            }
            return;
          }
          try {
            lastRequestMs.set(System.currentTimeMillis());
            Result result = callOpenRouter(job);
            Listener l = listener;
            if (l != null) {
              l.onAssistResult(result);
            }
          } finally {
            busy.set(false);
            if (pending.get() != null) {
              maybePump();
            }
          }
        });
  }

  private Result callOpenRouter(Pending job) {
    long t0 = System.currentTimeMillis();
    String key = getApiKey();
    String model = getModel();
    try {
      String b64 = encodeJpegBase64(job.jpeg);
      if (b64 == null) {
        return error(job.snapId, model, "jpeg encode failed", t0);
      }

      String system =
          "You assist a house walkthrough capture app. Reply with ONLY compact JSON "
              + "(no markdown): {\"room_guess\":\"short room name or unknown\","
              + "\"location_type\":\"interior|exterior|threshold\","
              + "\"shows\":\"comma tags e.g. door,window,corner,stairs\","
              + "\"tip\":\"one short coaching tip under 12 words for the walker\"}. "
              + "Prefer tips about missing corners, doors, scale cues, or light — never invent metric sizes.";

      String userText =
          String.format(
              Locale.US,
              "Snap %s. facing=%s location_type=%s snap_count=%d path_extent_m=%.1f. Local coach: %s",
              job.snapId,
              nullToEmpty(job.facing),
              nullToEmpty(job.locationType),
              job.snapCount,
              job.pathExtentM,
              nullToEmpty(job.coachHint));

      JSONObject imageUrl = new JSONObject();
      imageUrl.put("url", "data:image/jpeg;base64," + b64);

      JSONObject imagePart = new JSONObject();
      imagePart.put("type", "image_url");
      imagePart.put("image_url", imageUrl);

      JSONObject textPart = new JSONObject();
      textPart.put("type", "text");
      textPart.put("text", userText);

      JSONArray content = new JSONArray();
      content.put(textPart);
      content.put(imagePart);

      JSONObject userMsg = new JSONObject();
      userMsg.put("role", "user");
      userMsg.put("content", content);

      JSONObject sysMsg = new JSONObject();
      sysMsg.put("role", "system");
      sysMsg.put("content", system);

      JSONArray messages = new JSONArray();
      messages.put(sysMsg);
      messages.put(userMsg);

      JSONObject body = new JSONObject();
      body.put("model", model);
      body.put("messages", messages);
      body.put("max_tokens", 180);
      body.put("temperature", 0.2);

      HttpURLConnection conn = (HttpURLConnection) new URL(ENDPOINT).openConnection();
      conn.setConnectTimeout(12000);
      conn.setReadTimeout(25000);
      conn.setRequestMethod("POST");
      conn.setDoOutput(true);
      conn.setRequestProperty("Authorization", "Bearer " + key);
      conn.setRequestProperty("Content-Type", "application/json");
      conn.setRequestProperty("HTTP-Referer", "https://local.p2d.capture");
      conn.setRequestProperty("X-Title", "p2D Capture Live Assist");

      byte[] payload = body.toString().getBytes(StandardCharsets.UTF_8);
      conn.setFixedLengthStreamingMode(payload.length);
      try (OutputStream os = conn.getOutputStream()) {
        os.write(payload);
      }

      int code = conn.getResponseCode();
      BufferedReader reader =
          new BufferedReader(
              new InputStreamReader(
                  code >= 200 && code < 300 ? conn.getInputStream() : conn.getErrorStream(),
                  StandardCharsets.UTF_8));
      StringBuilder sb = new StringBuilder();
      String line;
      while ((line = reader.readLine()) != null) {
        sb.append(line);
      }
      reader.close();
      conn.disconnect();

      if (code < 200 || code >= 300) {
        String err = sb.toString();
        if (err.length() > 160) {
          err = err.substring(0, 160);
        }
        return error(job.snapId, model, "HTTP " + code + " " + err, t0);
      }

      JSONObject resp = new JSONObject(sb.toString());
      JSONArray choices = resp.optJSONArray("choices");
      if (choices == null || choices.length() == 0) {
        return error(job.snapId, model, "empty choices", t0);
      }
      String contentText =
          choices
              .getJSONObject(0)
              .getJSONObject("message")
              .optString("content", "");
      JSONObject parsed = extractJsonObject(contentText);
      if (parsed == null) {
        return error(job.snapId, model, "bad JSON from model", t0);
      }
      return new Result(
          job.snapId,
          parsed.optString("room_guess", ""),
          parsed.optString("location_type", ""),
          parsed.optString("shows", ""),
          parsed.optString("tip", ""),
          model,
          null,
          System.currentTimeMillis() - t0);
    } catch (Exception e) {
      Log.w(TAG, "OpenRouter assist failed", e);
      String msg = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
      if (msg.length() > 120) {
        msg = msg.substring(0, 120);
      }
      return error(job.snapId, model, msg, t0);
    }
  }

  private static Result error(String snapId, String model, String err, long t0) {
    return new Result(
        snapId, "", "", "", "", model, err, System.currentTimeMillis() - t0);
  }

  private static String nullToEmpty(String s) {
    return s == null ? "" : s;
  }

  private static String encodeJpegBase64(File jpeg) {
    BitmapFactory.Options bounds = new BitmapFactory.Options();
    bounds.inJustDecodeBounds = true;
    BitmapFactory.decodeFile(jpeg.getAbsolutePath(), bounds);
    int sample = 1;
    int maxDim = Math.max(bounds.outWidth, bounds.outHeight);
    while (maxDim / sample > MAX_EDGE_PX * 2) {
      sample *= 2;
    }
    BitmapFactory.Options opts = new BitmapFactory.Options();
    opts.inSampleSize = sample;
    Bitmap bmp = BitmapFactory.decodeFile(jpeg.getAbsolutePath(), opts);
    if (bmp == null) {
      return null;
    }
    int w = bmp.getWidth();
    int h = bmp.getHeight();
    float scale = Math.min(1f, MAX_EDGE_PX / (float) Math.max(w, h));
    Bitmap scaled = bmp;
    if (scale < 0.99f) {
      scaled =
          Bitmap.createScaledBitmap(
              bmp, Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)), true);
      if (scaled != bmp) {
        bmp.recycle();
      }
    }
    ByteArrayOutputStream baos = new ByteArrayOutputStream();
    scaled.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, baos);
    scaled.recycle();
    return Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP);
  }

  private static JSONObject extractJsonObject(String text) {
    if (text == null) {
      return null;
    }
    String t = text.trim();
    if (t.startsWith("```")) {
      int firstNl = t.indexOf('\n');
      int lastFence = t.lastIndexOf("```");
      if (firstNl >= 0 && lastFence > firstNl) {
        t = t.substring(firstNl + 1, lastFence).trim();
      }
    }
    int start = t.indexOf('{');
    int end = t.lastIndexOf('}');
    if (start < 0 || end <= start) {
      return null;
    }
    try {
      return new JSONObject(t.substring(start, end + 1));
    } catch (Exception e) {
      return null;
    }
  }
}
