/*
 * Drive-scan style framing rectangle — color shows snap readiness.
 */
package local.p2d.capture;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;
import android.util.AttributeSet;
import android.view.MotionEvent;
import android.view.View;
import androidx.annotation.Nullable;

/** Non-interactive overlay: rounded frame + corner ticks. */
public final class SnapGuideView extends View {
  private static final int COLOR_IDLE = 0x66FFFFFF;
  private static final int COLOR_HUNTING = 0xE6FFB300; // amber
  private static final int COLOR_READY = 0xE633C36B; // green
  private static final int COLOR_DUP = 0xE6FF7043; // orange
  private static final int COLOR_SNAPPING = 0xE64FC3F7; // light blue

  private final Paint strokePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
  private final Paint cornerPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
  private final Paint labelPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
  private final RectF frame = new RectF();

  private SnapAssistant.ReadyState state = SnapAssistant.ReadyState.IDLE;
  private String label = "";
  private boolean active = false;

  public SnapGuideView(Context context) {
    super(context);
    init();
  }

  public SnapGuideView(Context context, @Nullable AttributeSet attrs) {
    super(context, attrs);
    init();
  }

  public SnapGuideView(Context context, @Nullable AttributeSet attrs, int defStyleAttr) {
    super(context, attrs, defStyleAttr);
    init();
  }

  private void init() {
    setWillNotDraw(false);
    setClickable(false);
    setFocusable(false);
    strokePaint.setStyle(Paint.Style.STROKE);
    strokePaint.setStrokeWidth(dp(3));
    cornerPaint.setStyle(Paint.Style.STROKE);
    cornerPaint.setStrokeWidth(dp(5));
    cornerPaint.setStrokeCap(Paint.Cap.ROUND);
    labelPaint.setColor(0xFFFFFFFF);
    labelPaint.setTextAlign(Paint.Align.CENTER);
    labelPaint.setTextSize(dp(14));
    labelPaint.setFakeBoldText(true);
    labelPaint.setShadowLayer(dp(2), 0, dp(1), 0x88000000);
  }

  public void setGuide(SnapAssistant.ReadyState state, String reason, boolean sessionActive) {
    this.state = state == null ? SnapAssistant.ReadyState.IDLE : state;
    this.label = reason == null ? "" : reason;
    this.active = sessionActive;
    invalidate();
  }

  @Override
  public boolean onTouchEvent(MotionEvent event) {
    return false; // pass through to GLSurfaceView / controls
  }

  @Override
  protected void onDraw(Canvas canvas) {
    super.onDraw(canvas);
    if (!active) {
      return;
    }

    int color = colorFor(state);
    strokePaint.setColor(color);
    cornerPaint.setColor(color);

    float w = getWidth();
    float h = getHeight();
    float insetX = w * 0.14f;
    float insetY = h * 0.22f;
    // Keep frame below top controls roughly.
    float topBoost = Math.min(h * 0.06f, dp(48));
    frame.set(insetX, insetY + topBoost, w - insetX, h - insetY);

    float radius = dp(12);
    strokePaint.setAlpha(0x66);
    canvas.drawRoundRect(frame, radius, radius, strokePaint);

    float tick = Math.min(frame.width(), frame.height()) * 0.12f;
    drawCorner(canvas, frame.left, frame.top, tick, +1, +1);
    drawCorner(canvas, frame.right, frame.top, tick, -1, +1);
    drawCorner(canvas, frame.left, frame.bottom, tick, +1, -1);
    drawCorner(canvas, frame.right, frame.bottom, tick, -1, -1);

    if (label != null && !label.isEmpty()) {
      float ty = frame.bottom + dp(22);
      if (ty > h - dp(8)) {
        ty = frame.top - dp(10);
      }
      canvas.drawText(label, w * 0.5f, ty, labelPaint);
    }
  }

  private void drawCorner(Canvas c, float x, float y, float tick, int sx, int sy) {
    c.drawLine(x, y, x + sx * tick, y, cornerPaint);
    c.drawLine(x, y, x, y + sy * tick, cornerPaint);
  }

  private static int colorFor(SnapAssistant.ReadyState s) {
    switch (s) {
      case READY:
        return COLOR_READY;
      case HUNTING:
        return COLOR_HUNTING;
      case DUPLICATE:
        return COLOR_DUP;
      case SNAPPING:
        return COLOR_SNAPPING;
      case IDLE:
      default:
        return COLOR_IDLE;
    }
  }

  private float dp(float v) {
    return v * getResources().getDisplayMetrics().density;
  }
}
