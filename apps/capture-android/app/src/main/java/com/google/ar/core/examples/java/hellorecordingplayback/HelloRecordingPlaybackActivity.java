/*
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package com.google.ar.core.examples.java.hellorecordingplayback;

import android.Manifest.permission;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.opengl.GLES20;
import android.opengl.GLSurfaceView;
import android.os.Build;
import android.os.Build.VERSION_CODES;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.util.Log;
import android.view.MotionEvent;
import android.view.View;
import android.widget.Button;
import android.widget.TextView;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.google.ar.core.Anchor;
import com.google.ar.core.ArCoreApk;
import com.google.ar.core.Camera;
import com.google.ar.core.Frame;
import com.google.ar.core.HitResult;
import com.google.ar.core.Plane;
import com.google.ar.core.PlaybackStatus;
import com.google.ar.core.Point;
import com.google.ar.core.Point.OrientationMode;
import com.google.ar.core.PointCloud;
import com.google.ar.core.Pose;
import com.google.ar.core.RecordingConfig;
import com.google.ar.core.RecordingStatus;
import com.google.ar.core.Session;
import com.google.ar.core.Track;
import com.google.ar.core.TrackData;
import com.google.ar.core.Trackable;
import com.google.ar.core.TrackingState;
import com.google.ar.core.examples.java.common.helpers.DisplayRotationHelper;
import com.google.ar.core.examples.java.common.helpers.FullScreenHelper;
import com.google.ar.core.examples.java.common.helpers.SnackbarHelper;
import com.google.ar.core.examples.java.common.helpers.TapHelper;
import com.google.ar.core.examples.java.common.helpers.TrackingStateHelper;
import com.google.ar.core.examples.java.common.rendering.BackgroundRenderer;
import com.google.ar.core.examples.java.common.rendering.ObjectRenderer;
import com.google.ar.core.examples.java.common.rendering.ObjectRenderer.BlendMode;
import com.google.ar.core.examples.java.common.rendering.PlaneRenderer;
import com.google.ar.core.examples.java.common.rendering.PointCloudRenderer;
import com.google.ar.core.exceptions.CameraNotAvailableException;
import com.google.ar.core.exceptions.PlaybackFailedException;
import com.google.ar.core.exceptions.RecordingFailedException;
import com.google.ar.core.exceptions.UnavailableApkTooOldException;
import com.google.ar.core.exceptions.UnavailableArcoreNotInstalledException;
import com.google.ar.core.exceptions.UnavailableDeviceNotCompatibleException;
import com.google.ar.core.exceptions.UnavailableSdkTooOldException;
import com.google.ar.core.exceptions.UnavailableUserDeclinedInstallationException;
import java.io.File;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.FloatBuffer;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import javax.microedition.khronos.egl.EGLConfig;
import javax.microedition.khronos.opengles.GL10;
import local.p2d.capture.CameraConfigHelper;
import local.p2d.capture.CaptureSessionWriter;
import local.p2d.capture.FacingSensor;
import local.p2d.capture.R;
import local.p2d.capture.SnapAssistant;
import local.p2d.capture.SnapGuideView;
import org.joda.time.DateTime;

/**
 * This is a simple example that shows how to create an augmented reality (AR) app that demonstrates
 * recording and playback of the AR session:
 *
 * <ul>
 *   - During recording, ARCore captures device camera and IMU sensor to an MP4 video file.
 *   <li>During plaback, ARCore replays the recorded session.
 *   <li>The app visualizes detected planes.
 *   <li>The user can tap on a detected plane to place a 3D model. These taps are simultaneously
 *       recorded in a separate MP4 data track, so that the taps can be replayed during playback.
 * </ul>
 */
public class HelloRecordingPlaybackActivity extends AppCompatActivity
    implements GLSurfaceView.Renderer {
  // Application states.
  private enum AppState {
    IDLE,
    RECORDING,
    PLAYBACK
  }

  private static final String TAG = HelloRecordingPlaybackActivity.class.getSimpleName();

  // p2D capture folder: capture_YYYYMMDD_HHMMSS/{video.mp4,poses.jsonl,manifest.json}
  private static final String CAPTURE_DIR_TEMPLATE = "capture_%s";
  private static final String CAPTURE_TIMESTAMP_FORMAT = "yyyyMMdd_HHmmss";

  // Keys to keep track of the active dataset and playback state between restarts.
  private static final String DESIRED_DATASET_PATH_KEY = "desired_dataset_path_key";
  private static final String DESIRED_APP_STATE_KEY = "desired_app_state_key";
  private static final int PERMISSIONS_REQUEST_CODE = 0;

  // Recording and playback requires android.permission.WRITE_EXTERNAL_STORAGE and
  // android.permission.CAMERA to operate. These permissions must be mirrored in the manifest.
  private static final String[] REQUIRED_PERMISSIONS_FOR_ANDROID_S_AND_BELOW = {
    permission.CAMERA, permission.WRITE_EXTERNAL_STORAGE
  };
  private static final String[] REQUIRED_PERMISSIONS_FOR_ANDROID_T_AND_ABOVE = {
    permission.CAMERA, permission.READ_MEDIA_VIDEO
  };

  // Randomly generated UUID and custom MIME type to mark the anchor track for this sample.
  private static final UUID ANCHOR_TRACK_ID =
      UUID.fromString("a65e59fc-2e13-4607-b514-35302121c138");
  private static final String ANCHOR_TRACK_MIME_TYPE =
      "application/hello-recording-playback-anchor";

  // The app state so that it can be preserved when the activity restarts. This is also used to
  // update the UI.
  private final AtomicReference<AppState> currentState = new AtomicReference<>(AppState.IDLE);

  private String playbackDatasetPath;
  private String lastRecordingDatasetPath;
  private CaptureSessionWriter captureWriter;
  private FacingSensor facingSensor;
  /** Low CPU for smooth tracking; stills use the same config (HD switch disabled — unstable on device). */
  private CameraConfigHelper.Pair cameraPair;
  private Button startRecordingButton;
  private Button stopRecordingButton;
  private Button startPlaybackButton;
  private Button stopPlaybackButton;
  private Button snapButton;
  private Button autoSnapButton;
  private Button locExteriorButton;
  private Button locInteriorButton;
  private Button locThresholdButton;
  private TextView recordingPlaybackPathTextView;
  private TextView statusTextView;
  private SnapGuideView snapGuideView;
  private final SnapAssistant snapAssistant = new SnapAssistant();
  private volatile String selectedLocationType = "interior";
  private volatile String lastTrackingLabel = "—";
  private volatile String planeHint = "";
  private int uiSnapCount = 0;
  private int statusUiTick = 0;
  private volatile boolean lastSnapUiReady = false;

  private Session session;
  private final SnackbarHelper messageSnackbarHelper = new SnackbarHelper();
  private DisplayRotationHelper displayRotationHelper;
  private final TrackingStateHelper trackingStateHelper = new TrackingStateHelper(this);
  private TapHelper tapHelper;
  private GLSurfaceView surfaceView;

  // The Renderers are created here, and initialized when the GL surface is created.
  private final BackgroundRenderer backgroundRenderer = new BackgroundRenderer();
  private final ObjectRenderer virtualObject = new ObjectRenderer();
  private final ObjectRenderer virtualObjectShadow = new ObjectRenderer();
  private final PlaneRenderer planeRenderer = new PlaneRenderer();
  private final PointCloudRenderer pointCloudRenderer = new PointCloudRenderer();

  // Temporary matrix allocated here to reduce number of allocations for each frame.
  private final float[] anchorMatrix = new float[16];
  private static final float[] DEFAULT_COLOR = new float[] {0f, 0f, 0f, 0f};

  private static class ColoredAnchor {
    public final Anchor anchor;
    public final float[] color;

    public ColoredAnchor(Anchor a, float[] color4f) {
      this.anchor = a;
      this.color = color4f;
    }
  }

  private final ArrayList<ColoredAnchor> anchors = new ArrayList<>();
  private final ArrayList<ColoredAnchor> anchorsToBeRecorded = new ArrayList<>();

  private boolean installRequested;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    loadInternalStateFromIntentExtras();

    setContentView(R.layout.activity_main);
    surfaceView = findViewById(R.id.surfaceview);
    displayRotationHelper = new DisplayRotationHelper(/*context=*/ this);

    // Set up touch listener.
    tapHelper = new TapHelper(/*context=*/ this);
    surfaceView.setOnTouchListener(tapHelper);

    // Set up renderer.
    surfaceView.setPreserveEGLContextOnPause(true);
    surfaceView.setEGLContextClientVersion(2);
    surfaceView.setEGLConfigChooser(8, 8, 8, 8, 16, 0); // Alpha used for plane blending.
    surfaceView.setRenderer(this);
    surfaceView.setRenderMode(GLSurfaceView.RENDERMODE_CONTINUOUSLY);
    surfaceView.setWillNotDraw(false);

    installRequested = false;
    facingSensor = new FacingSensor(this);
    facingSensor.start();

    recordingPlaybackPathTextView = findViewById(R.id.recording_playback_path);
    statusTextView = findViewById(R.id.status_text);
    startRecordingButton = findViewById(R.id.start_recording_button);
    stopRecordingButton = findViewById(R.id.stop_recording_button);
    startPlaybackButton = findViewById(R.id.playback_button);
    stopPlaybackButton = findViewById(R.id.close_playback_button);
    snapButton = findViewById(R.id.snap_button);
    autoSnapButton = findViewById(R.id.auto_snap_button);
    snapGuideView = findViewById(R.id.snap_guide);
    locExteriorButton = findViewById(R.id.loc_exterior);
    locInteriorButton = findViewById(R.id.loc_interior);
    locThresholdButton = findViewById(R.id.loc_threshold);
    startRecordingButton.setOnClickListener(view -> startRecording());
    stopRecordingButton.setOnClickListener(view -> stopRecording());
    startPlaybackButton.setOnClickListener(view -> startPlayback());
    stopPlaybackButton.setOnClickListener(view -> stopPlayback());
    snapButton.setOnClickListener(view -> requestSnap());
    if (autoSnapButton != null) {
      autoSnapButton.setOnClickListener(view -> toggleAutoSnap());
    }
    locExteriorButton.setOnClickListener(view -> setLocationType("exterior"));
    locInteriorButton.setOnClickListener(view -> setLocationType("interior"));
    locThresholdButton.setOnClickListener(view -> setLocationType("threshold"));
    setLocationType("interior");
    snapAssistant.setAutoEnabled(true);
    refreshAutoSnapButton();
    updateUI();
  }

  private void vibrateTick(int ms) {
    try {
      Vibrator vibrator;
      if (Build.VERSION.SDK_INT >= 31) {
        VibratorManager vm = (VibratorManager) getSystemService(VIBRATOR_MANAGER_SERVICE);
        vibrator = vm != null ? vm.getDefaultVibrator() : null;
      } else {
        vibrator = (Vibrator) getSystemService(VIBRATOR_SERVICE);
      }
      if (vibrator == null || !vibrator.hasVibrator()) {
        return;
      }
      if (Build.VERSION.SDK_INT >= 26) {
        vibrator.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE));
      } else {
        vibrator.vibrate(ms);
      }
    } catch (Throwable ignored) {
    }
  }

  private void setLocationType(String type) {
    selectedLocationType = type;
    int hi = 0xFF90CAF9;
    int lo = 0xFF424242;
    locExteriorButton.setBackgroundColor("exterior".equals(type) ? hi : lo);
    locInteriorButton.setBackgroundColor("interior".equals(type) ? hi : lo);
    locThresholdButton.setBackgroundColor("threshold".equals(type) ? hi : lo);
    refreshStatusUi();
  }

  private void toggleAutoSnap() {
    snapAssistant.setAutoEnabled(!snapAssistant.isAutoEnabled());
    refreshAutoSnapButton();
    messageSnackbarHelper.showMessageForShortDuration(
        this,
        snapAssistant.isAutoEnabled()
            ? "AUTO on — walk; snaps when frame stays green"
            : "AUTO off — tap SNAP when green");
  }

  private void refreshAutoSnapButton() {
    if (autoSnapButton == null) {
      return;
    }
    boolean on = snapAssistant.isAutoEnabled();
    autoSnapButton.setText(on ? R.string.auto_snap_on_text : R.string.auto_snap_off_text);
    autoSnapButton.setBackgroundColor(on ? 0xFF2E7D32 : 0xFF424242);
  }

  private void requestSnap() {
    if (currentState.get() != AppState.RECORDING || captureWriter == null) {
      messageSnackbarHelper.showMessageForShortDuration(this, "Start capture first");
      return;
    }
    if (snapAssistant.getState() == SnapAssistant.ReadyState.DUPLICATE) {
      snapAssistant.forceNextDuplicate();
      messageSnackbarHelper.showMessageForShortDuration(this, "Forcing snap of this view…");
    } else if (!snapAssistant.isSnapReady() && !snapAssistant.isRetrying()) {
      messageSnackbarHelper.showMessageForShortDuration(
          this, "Wait for green frame — " + snapAssistant.getReason());
      // Still queue a retry so a near-ready tap can succeed.
    }
    snapAssistant.requestManualSnap();
    updateSnapChrome();
  }

  private void refreshStatusUi() {
    runOnUiThread(
        () -> {
          if (statusTextView == null) return;
          String state = currentState.get().name();
          String plane =
              planeHint == null || planeHint.isEmpty() ? "" : (" · " + planeHint);
          String cam = "";
          if (cameraPair != null) {
            cam = " · " + cameraPair.tracking.label;
          }
          String ready =
              currentState.get() == AppState.RECORDING
                  ? (" · " + snapAssistant.getState().name().toLowerCase(Locale.US))
                  : "";
          statusTextView.setText(
              state
                  + " · "
                  + lastTrackingLabel
                  + " · snaps "
                  + uiSnapCount
                  + " · loc "
                  + selectedLocationType
                  + ready
                  + plane
                  + cam);
          updateSnapChrome();
        });
  }

  private void updateSnapChrome() {
    runOnUiThread(
        () -> {
          boolean recording = currentState.get() == AppState.RECORDING;
          if (snapGuideView != null) {
            snapGuideView.setGuide(
                recording ? snapAssistant.getState() : SnapAssistant.ReadyState.IDLE,
                recording ? snapAssistant.getReason() : "",
                recording);
          }
          if (snapButton != null && recording) {
            snapButton.setEnabled(true);
            lastSnapUiReady = snapAssistant.isSnapReady();
            if (snapAssistant.isRetrying()
                || snapAssistant.getState() == SnapAssistant.ReadyState.SNAPPING) {
              snapButton.setText("…");
              snapButton.setBackgroundColor(0xFF0277BD);
            } else if (snapAssistant.getState() == SnapAssistant.ReadyState.DUPLICATE) {
              snapButton.setText("DUP?");
              snapButton.setBackgroundColor(0xFFE64A19);
            } else if (snapAssistant.getState() == SnapAssistant.ReadyState.READY) {
              snapButton.setText(R.string.snap_button_text);
              snapButton.setBackgroundColor(0xFF2E7D32);
            } else {
              snapButton.setText("WAIT");
              snapButton.setBackgroundColor(0xFF616161);
            }
          }
        });
  }

  @Override
  protected void onResume() {
    super.onResume();
    if (facingSensor != null) {
      facingSensor.start();
    }

    if (session == null) {
      Exception exception = null;
      String message = null;
      try {
        switch (ArCoreApk.getInstance().requestInstall(this, !installRequested)) {
          case INSTALL_REQUESTED:
            installRequested = true;
            return;
          case INSTALLED:
            break;
        }

        // If we did not yet obtain runtime permission on Android M and above, now is a good time to
        // ask the user for it.
        if (requestPermissions(getPermissionsForTargetSDK())) {
          return;
        }

        // Create the session — keep low CPU for stable tracking; stills use same config.
        session = new Session(/* context= */ this);
        try {
          cameraPair = CameraConfigHelper.selectTrackingAndSnap(session);
          CameraConfigHelper.apply(session, cameraPair.tracking);
          planeHint = "track " + cameraPair.tracking.label;
          Log.i(
              TAG,
              "Camera config tracking="
                  + cameraPair.tracking.label
                  + " (HD snap switch disabled)");
        } catch (Throwable t) {
          Log.w(TAG, "Could not set camera configs; using default", t);
          cameraPair = null;
        }
        if (currentState.get() == AppState.PLAYBACK) {
          // Dataset playback will start when session.resume() is called.
          setPlaybackDatasetPath();
        }
      } catch (UnavailableArcoreNotInstalledException
          | UnavailableUserDeclinedInstallationException e) {
        message = "Please install Google Play Services for AR (ARCore)";
        exception = e;
      } catch (UnavailableApkTooOldException e) {
        message = "Please update Google Play Services for AR (ARCore)";
        exception = e;
      } catch (UnavailableSdkTooOldException e) {
        message = "Please update this app";
        exception = e;
      } catch (UnavailableDeviceNotCompatibleException e) {
        message = "This device does not support AR";
        exception = e;
      } catch (Exception e) {
        message = "Failed to create AR session";
        exception = e;
      }

      if (message != null) {
        messageSnackbarHelper.showError(this, message + " " + exception);
        Log.e(TAG, "Exception creating session", exception);
        return;
      }
    }

    // Note that order matters - see the note in onPause(), the reverse applies here.
    try {
      // Playback will now start if an MP4 dataset has been set.
      session.resume();
    } catch (CameraNotAvailableException e) {
      messageSnackbarHelper.showError(this, "Camera not available. Try restarting the app.");
      session = null;
      return;
    }

    if (currentState.get() == AppState.PLAYBACK) {
      // Must be called after dataset playback is started by call to session.resume().
      checkPlaybackStatus();
    }
    surfaceView.onResume();
    displayRotationHelper.onResume();
    updateUI();
  }

  @Override
  public void onPause() {
    super.onPause();
    if (facingSensor != null) {
      facingSensor.stop();
    }
    if (session != null) {
      // Note that the order matters - GLSurfaceView is paused first so that it does not try
      // to query the session. If Session is paused before GLSurfaceView, GLSurfaceView may
      // still call session.update() and get a SessionPausedException.
      displayRotationHelper.onPause();
      surfaceView.onPause();
      if (currentState.get() == AppState.RECORDING) {
        stopRecording();
      }
      session.pause();
    }
  }

  @Override
  protected void onDestroy() {
    if (session != null) {
      // Explicitly close ARCore Session to release native resources.
      // Review the API reference for important considerations before calling close() in apps with
      // more complicated lifecycle requirements:
      // https://developers.google.com/ar/reference/java/arcore/reference/com/google/ar/core/Session#close()
      session.close();
      session = null;
    }

    super.onDestroy();
  }

  @Override
  public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
    super.onRequestPermissionsResult(requestCode, permissions, results);
    if (requestCode == PERMISSIONS_REQUEST_CODE) {
      for (int i = 0; i < results.length; i++) {
        if (results[i] != PackageManager.PERMISSION_GRANTED) {
          logAndShowErrorMessage("Cannot start app, missing permission: " + permissions[i]);
          finish();
        }
      }
    }
  }

  @Override
  public void onWindowFocusChanged(boolean hasFocus) {
    super.onWindowFocusChanged(hasFocus);
    FullScreenHelper.setFullScreenOnWindowFocusChanged(this, hasFocus);
  }

  @Override
  public void onSurfaceCreated(GL10 gl, EGLConfig config) {
    GLES20.glClearColor(0.1f, 0.1f, 0.1f, 1.0f);

    // Prepare the rendering objects. This involves reading shaders, so may throw an IOException.
    try {
      // Create the texture and pass it to ARCore session to be filled during update().
      backgroundRenderer.createOnGlThread(/*context=*/ this);
      planeRenderer.createOnGlThread(/*context=*/ this, "models/trigrid.png");
      pointCloudRenderer.createOnGlThread(/*context=*/ this);

      virtualObject.createOnGlThread(/*context=*/ this, "models/andy.obj", "models/andy.png");
      virtualObject.setMaterialProperties(0.0f, 2.0f, 0.5f, 6.0f);

      virtualObjectShadow.createOnGlThread(
          /*context=*/ this, "models/andy_shadow.obj", "models/andy_shadow.png");
      virtualObjectShadow.setBlendMode(BlendMode.Shadow);
      virtualObjectShadow.setMaterialProperties(1.0f, 0.0f, 0.0f, 1.0f);

    } catch (IOException e) {
      Log.e(TAG, "Failed to read an asset file", e);
    }
  }

  @Override
  public void onSurfaceChanged(GL10 gl, int width, int height) {
    displayRotationHelper.onSurfaceChanged(width, height);
    GLES20.glViewport(0, 0, width, height);
  }

  @Override
  public void onDrawFrame(GL10 gl) {
    // Clear screen to tell driver it should not load any pixels from previous frame.
    GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT | GLES20.GL_DEPTH_BUFFER_BIT);

    // Do not render anything or call session methods until session is created.
    if (session == null) {
      return;
    }

    // Notify ARCore session that the view size changed so that the projection matrix and
    // the video background can be properly adjusted.
    displayRotationHelper.updateSessionIfNeeded(session);

    try {
      session.setCameraTextureName(backgroundRenderer.getTextureId());

      // Obtain the current frame from ARSession. When the configuration is set to
      // UpdateMode.BLOCKING (it is by default), this will throttle the rendering to the
      // camera framerate.
      Frame frame = session.update();
      Camera camera = frame.getCamera();
      lastTrackingLabel = camera.getTrackingState().name();

      int featureCount = 0;
      PointCloud heldCloud = null;
      try {
        heldCloud = frame.acquirePointCloud();
        featureCount = countConfidentFeatures(heldCloud);
      } catch (Throwable t) {
        Log.w(TAG, "Point cloud unavailable", t);
      }

      String failReason = "";
      if (camera.getTrackingState() != TrackingState.TRACKING) {
        failReason = TrackingStateHelper.getTrackingFailureReasonString(camera);
      }

      boolean shouldSnap = false;
      if (currentState.get() == AppState.RECORDING && captureWriter != null) {
        shouldSnap =
            snapAssistant.updateFrame(
                camera.getTrackingState(),
                featureCount,
                camera.getDisplayOrientedPose(),
                failReason);

        if (snapAssistant.stateChangedForLog()) {
          Pose p = camera.getDisplayOrientedPose();
          float[] t = p.getTranslation();
          captureWriter.appendReadyEvent(
              frame.getTimestamp(),
              snapAssistant.getState().name(),
              featureCount,
              snapAssistant.isAutoEnabled(),
              snapAssistant.getReason(),
              t,
              CaptureSessionWriter.yawDegFromPose(p));
        }
        if (snapAssistant.consumeJustBecameReady()) {
          runOnUiThread(() -> vibrateTick(35));
        }
      }

      if ((++statusUiTick % 8) == 0
          || shouldSnap
          || snapAssistant.isRetrying()
          || lastSnapUiReady != snapAssistant.isSnapReady()) {
        refreshStatusUi();
      }

      // p2D: append metric pose + facing while recording.
      if (currentState.get() == AppState.RECORDING && captureWriter != null) {
        String facing = facingSensor != null ? facingSensor.currentFacingOrNull() : null;
        if (facing == null) {
          facing =
              CaptureSessionWriter.facingFromYawDeg(
                  CaptureSessionWriter.yawDegFromPose(camera.getDisplayOrientedPose()));
        }
        captureWriter.appendPose(frame, camera, facing);

        if (shouldSnap) {
          final String snapId =
              captureWriter.takeSnap(
                  frame, camera, facing, selectedLocationType, /* note= */ "");
          if (snapId != null) {
            snapAssistant.recordSuccessfulSnap(
                SnapAssistant.SnapPose.from(camera.getDisplayOrientedPose()));
            final int count = captureWriter.getSnapCount();
            runOnUiThread(
                () -> {
                  uiSnapCount = count;
                  vibrateTick(55);
                  messageSnackbarHelper.showMessageForShortDuration(
                      HelloRecordingPlaybackActivity.this, "Saved " + snapId);
                  refreshStatusUi();
                });
          } else {
            // Re-queue a short retry if JPEG failed mid-tracking.
            snapAssistant.requestManualSnap();
            runOnUiThread(
                () ->
                    messageSnackbarHelper.showMessageForShortDuration(
                        HelloRecordingPlaybackActivity.this, "Snap encode failed — retrying…"));
          }
        }
      }

      // Handle one tap per frame.
      ColoredAnchor anchor = handleTap(frame, camera);
      if (anchor != null) {
        // If we created an anchor, then try to record it.
        anchorsToBeRecorded.add(anchor);
      }

      // Try to record any anchors that have not been recorded yet.
      recordAnchors(session, frame, camera);

      // If we are playing back, then add any recorded anchors to the session.
      addRecordedAnchors(session, frame, camera);

      // If frame is ready, render camera preview image to the GL surface.
      backgroundRenderer.draw(frame);

      // Keep the screen unlocked while tracking, but allow it to lock when tracking stops.
      trackingStateHelper.updateKeepScreenOnFlag(camera.getTrackingState());

      // If not tracking, skip 3D overlays — status bar only (no bottom snackbar over buttons).
      if (camera.getTrackingState() == TrackingState.PAUSED) {
        lastTrackingLabel = "PAUSED";
        if (failReason != null && !failReason.isEmpty()) {
          planeHint = failReason;
        }
        if (heldCloud != null) {
          heldCloud.close();
          heldCloud = null;
        }
        return;
      }

      // Get projection matrix.
      float[] projmtx = new float[16];
      camera.getProjectionMatrix(projmtx, 0, 0.1f, 100.0f);

      // Get camera matrix and draw.
      float[] viewmtx = new float[16];
      camera.getViewMatrix(viewmtx, 0);

      // Compute lighting from average intensity of the image.
      // The first three components are color scaling factors.
      // The last one is the average pixel intensity in gamma space.
      final float[] colorCorrectionRgba = new float[4];
      frame.getLightEstimate().getColorCorrection(colorCorrectionRgba, 0);

      // Visualize tracked points (reuse cloud acquired above).
      if (heldCloud != null) {
        try {
          pointCloudRenderer.update(heldCloud);
          pointCloudRenderer.draw(viewmtx, projmtx);
        } finally {
          heldCloud.close();
          heldCloud = null;
        }
      }

      // Surface search → status bar only. Never indefinite bottom snackbar (it covered buttons).
      if (hasTrackingPlane()) {
        planeHint = "surfaces OK · pts " + featureCount;
      } else {
        planeHint = "searching surfaces · pts " + featureCount;
      }

      // Visualize detected planes.
      planeRenderer.drawPlanes(
          session.getAllTrackables(Plane.class), camera.getDisplayOrientedPose(), projmtx);

      // Visualize anchors created by tapping.
      float scaleFactor = 1.0f;
      for (ColoredAnchor coloredAnchor : anchors) {
        if (coloredAnchor.anchor.getTrackingState() != TrackingState.TRACKING) {
          continue;
        }
        // Get the current pose of an Anchor in world space. The Anchor pose is updated
        // during calls to session.update() as ARCore refines its estimate of the world.
        coloredAnchor.anchor.getPose().toMatrix(anchorMatrix, 0);

        // Update and draw the model and its shadow.
        virtualObject.updateModelMatrix(anchorMatrix, scaleFactor);
        virtualObjectShadow.updateModelMatrix(anchorMatrix, scaleFactor);
        virtualObject.draw(viewmtx, projmtx, colorCorrectionRgba, coloredAnchor.color);
        virtualObjectShadow.draw(viewmtx, projmtx, colorCorrectionRgba, coloredAnchor.color);
      }

    } catch (Throwable t) {
      // Avoid crashing the application due to unhandled exceptions.
      Log.e(TAG, "Exception on the OpenGL thread", t);
    }
  }

  /** Count point-cloud features with reasonable confidence. */
  private static int countConfidentFeatures(PointCloud pointCloud) {
    if (pointCloud == null) {
      return 0;
    }
    FloatBuffer pts = pointCloud.getPoints();
    if (pts == null) {
      return 0;
    }
    int count = 0;
    // Each point: x, y, z, confidence
    for (int i = 0; i + 3 < pts.limit(); i += 4) {
      if (pts.get(i + 3) >= 0.15f) {
        count++;
      }
    }
    return count;
  }

  /** Try to create an anchor if the user has tapped the screen. */
  private ColoredAnchor handleTap(Frame frame, Camera camera) {
    // Handle only one tap per frame, as taps are usually low frequency compared to frame rate.
    MotionEvent tap = tapHelper.poll();
    if (tap != null && camera.getTrackingState() == TrackingState.TRACKING) {
      for (HitResult hit : frame.hitTest(tap)) {
        // Check if any plane was hit, and if it was hit inside the plane polygon.
        Trackable trackable = hit.getTrackable();
        // Creates an anchor if a plane or an oriented point was hit.
        if ((trackable instanceof Plane
                && ((Plane) trackable).isPoseInPolygon(hit.getHitPose())
                && (PlaneRenderer.calculateDistanceToPlane(hit.getHitPose(), camera.getPose()) > 0))
            || (trackable instanceof Point
                && ((Point) trackable).getOrientationMode()
                    == OrientationMode.ESTIMATED_SURFACE_NORMAL)) {
          // Hits are sorted by depth. Consider only closest hit on a plane or oriented point.
          // Cap the number of objects created. This avoids overloading both the
          // rendering system and ARCore.
          if (anchors.size() >= 20) {
            anchors.get(0).anchor.detach();
            anchors.remove(0);
          }

          // Assign a color to the object for rendering based on the trackable type
          // this anchor attached to.
          float[] objColor;
          if (trackable instanceof Point) {
            objColor = new float[] {66.0f, 133.0f, 244.0f, 255.0f}; // Blue.
          } else if (trackable instanceof Plane) {
            objColor = new float[] {139.0f, 195.0f, 74.0f, 255.0f}; // Green.
          } else {
            objColor = DEFAULT_COLOR;
          }

          ColoredAnchor anchor = new ColoredAnchor(hit.createAnchor(), objColor);
          // Adding an Anchor tells ARCore that it should track this position in
          // space. This anchor is created on the Plane to place the 3D model
          // in the correct position relative both to the world and to the plane.
          anchors.add(anchor);
          return anchor;
        }
      }
    }
    return null;
  }

  /**
   * Try to add anchors to an MP4 data track track if the app is currently recording.
   *
   * <p>Track data recording can sometimes fail due an image not being available for recording in
   * ARCore, so we try to record all anchors that have not been recorded yet.
   */
  private void recordAnchors(Session session, Frame frame, Camera camera) {
    if (!session.getRecordingStatus().equals(RecordingStatus.OK)) {
      // We do not record anchors created before we started recording.
      anchorsToBeRecorded.clear();
      return;
    }

    Iterator<ColoredAnchor> anchorIterator = anchorsToBeRecorded.iterator();
    while (anchorIterator.hasNext()) {
      ColoredAnchor anchor = anchorIterator.next();
      // Transform the anchor pose world coordinates in to camera coordinate frame for easy
      // placement during playback.
      Pose pose = camera.getPose().inverse().compose(anchor.anchor.getPose());
      float[] translation = pose.getTranslation();
      float[] quaternion = pose.getRotationQuaternion();
      ByteBuffer payload =
          ByteBuffer.allocate(4 * (translation.length + quaternion.length + anchor.color.length));
      FloatBuffer floatView = payload.asFloatBuffer();
      floatView.put(translation);
      floatView.put(quaternion);
      floatView.put(anchor.color);

      try {
        frame.recordTrackData(ANCHOR_TRACK_ID, payload);
        anchorIterator.remove();
      } catch (IllegalStateException e) {
        Log.e(TAG, "Could not record anchor into external data track.", e);
        return;
      }
    }
  }

  /** During playback, recreate any anchors that were placed during recording. */
  private void addRecordedAnchors(Session session, Frame frame, Camera camera) {
    for (TrackData data : frame.getUpdatedTrackData(ANCHOR_TRACK_ID)) {
      ByteBuffer payload = data.getData();

      float[] translation = new float[3];
      float[] quaternion = new float[4];
      float[] color = new float[4];

      FloatBuffer floatView = payload.asFloatBuffer();
      floatView.get(translation);
      floatView.get(quaternion);
      floatView.get(color);

      // Transform the recorded anchor pose in the camera coordinate frame back into world
      // coordinates.
      Pose pose = camera.getPose().compose(new Pose(translation, quaternion));
      ColoredAnchor anchor = new ColoredAnchor(session.createAnchor(pose), color);
      anchors.add(anchor);
    }
  }

  /** Checks if we detected at least one plane. */
  private boolean hasTrackingPlane() {
    for (Plane plane : session.getAllTrackables(Plane.class)) {
      if (plane.getTrackingState() == TrackingState.TRACKING) {
        return true;
      }
    }
    return false;
  }

  /**
   * Requests any not (yet) granted required permissions needed for recording and playback.
   *
   * <p>Returns false if all permissions are already granted. Otherwise, requests missing
   * permissions and returns true.
   */
  private boolean requestPermissions(String[] permissions) {
    List<String> permissionsNotGranted = new ArrayList<>();
    for (String permission : permissions) {
      if (ContextCompat.checkSelfPermission(this, permission)
          != PackageManager.PERMISSION_GRANTED) {
        permissionsNotGranted.add(permission);
      }
    }
    if (permissionsNotGranted.isEmpty()) {
      return false;
    }
    ActivityCompat.requestPermissions(
        this, permissionsNotGranted.toArray(new String[0]), PERMISSIONS_REQUEST_CODE);
    return true;
  }

  /** Sets the path of the MP4 dataset to playback. */
  private void setPlaybackDatasetPath() {
    if (session.getPlaybackStatus() == PlaybackStatus.OK) {
      logAndShowErrorMessage("Session is already playing back.");
      setStateAndUpdateUI(AppState.PLAYBACK);
      return;
    }
    if (playbackDatasetPath != null) {
      try {
        session.setPlaybackDatasetUri(Uri.fromFile(new File(playbackDatasetPath)));
      } catch (PlaybackFailedException e) {
        String errorMsg = "Failed to set playback MP4 dataset. " + e;
        Log.e(TAG, errorMsg, e);
        messageSnackbarHelper.showError(this, errorMsg);
        Log.d(TAG, "Setting app state to IDLE, as the playback is not in progress.");
        setStateAndUpdateUI(AppState.IDLE);
        return;
      }
      setStateAndUpdateUI(AppState.PLAYBACK);
    }
  }

  /** Generates a new capture folder path: .../captures/capture_YYYYMMDD_HHMMSS/video.mp4 */
  private String getNewDatasetPath() {
    File baseDir = this.getExternalFilesDir(null);
    if (baseDir == null) {
      return null;
    }
    File capturesRoot = new File(baseDir, "captures");
    String stamp = DateTime.now().toString(CAPTURE_TIMESTAMP_FORMAT);
    File captureDir =
        new File(capturesRoot, String.format(Locale.ENGLISH, CAPTURE_DIR_TEMPLATE, stamp));
    if (!captureDir.exists() && !captureDir.mkdirs()) {
      return null;
    }
    return new File(captureDir, "video.mp4").getAbsolutePath();
  }

  /** Updates UI behaviors based on current app state. */
  private void updateUI() {
    switch (currentState.get()) {
      case IDLE:
        startRecordingButton.setVisibility(View.VISIBLE);
        startRecordingButton.setEnabled(true);
        stopRecordingButton.setVisibility(View.GONE);
        stopRecordingButton.setEnabled(false);
        stopPlaybackButton.setVisibility(View.GONE);
        stopPlaybackButton.setEnabled(false);
        startPlaybackButton.setEnabled(false);
        if (snapButton != null) {
          snapButton.setEnabled(false);
          snapButton.setText(R.string.snap_button_text);
          snapButton.setBackgroundColor(0xFF424242);
        }
        if (snapGuideView != null) {
          snapGuideView.setGuide(SnapAssistant.ReadyState.IDLE, "", false);
        }
        recordingPlaybackPathTextView.setText(
            getResources()
                .getString(
                    R.string.playback_path_text,
                    playbackDatasetPath == null ? "" : playbackDatasetPath));
        break;
      case RECORDING:
        startRecordingButton.setVisibility(View.GONE);
        startRecordingButton.setEnabled(false);
        stopRecordingButton.setVisibility(View.VISIBLE);
        stopRecordingButton.setEnabled(true);
        stopPlaybackButton.setVisibility(View.GONE);
        stopPlaybackButton.setEnabled(false);
        startPlaybackButton.setEnabled(false);
        if (snapButton != null) {
          // Enabled/color driven by snapAssistant via updateSnapChrome().
          snapButton.setEnabled(false);
        }
        recordingPlaybackPathTextView.setText(
            getResources()
                .getString(
                    R.string.recording_path_text,
                    lastRecordingDatasetPath == null ? "" : lastRecordingDatasetPath));
        updateSnapChrome();
        break;
      case PLAYBACK:
        startRecordingButton.setVisibility(View.INVISIBLE);
        stopRecordingButton.setVisibility(View.INVISIBLE);
        startPlaybackButton.setVisibility(View.INVISIBLE);
        startRecordingButton.setEnabled(false);
        stopRecordingButton.setEnabled(false);
        stopPlaybackButton.setVisibility(View.VISIBLE);
        stopPlaybackButton.setEnabled(true);
        if (snapButton != null) {
          snapButton.setEnabled(false);
          snapButton.setText(R.string.snap_button_text);
        }
        if (snapGuideView != null) {
          snapGuideView.setGuide(SnapAssistant.ReadyState.IDLE, "", false);
        }
        recordingPlaybackPathTextView.setText("");
        break;
    }
    refreshStatusUi();
  }

  /** Performs action when start_recording button is clicked. */
  private void startRecording() {
    try {
      lastRecordingDatasetPath = getNewDatasetPath();
      if (lastRecordingDatasetPath == null) {
        logAndShowErrorMessage("Failed to generate a capture path for recording.");
        return;
      }

      File videoFile = new File(lastRecordingDatasetPath);
      File captureDir = videoFile.getParentFile();
      try {
        if (captureWriter != null) {
          captureWriter.close();
          captureWriter = null;
        }
        captureWriter = new CaptureSessionWriter(captureDir);
        if (cameraPair != null) {
          captureWriter.setCameraConfigLabel("track=" + cameraPair.tracking.label);
          captureWriter.setExpectedImageSize(
              cameraPair.tracking.cpuSize.getWidth(), cameraPair.tracking.cpuSize.getHeight());
        }
        uiSnapCount = 0;
        boolean autoOn = snapAssistant.isAutoEnabled();
        snapAssistant.resetSession();
        snapAssistant.setAutoEnabled(autoOn);
      } catch (IOException e) {
        logAndShowErrorMessage("Failed to open poses.jsonl: " + e.getMessage());
        return;
      }

      Track anchorTrack =
          new Track(session).setId(ANCHOR_TRACK_ID).setMimeType(ANCHOR_TRACK_MIME_TYPE);

      session.startRecording(
          new RecordingConfig(session)
              .setMp4DatasetUri(Uri.fromFile(videoFile))
              .setAutoStopOnPause(false)
              .addTrack(anchorTrack));
    } catch (RecordingFailedException e) {
      String errorMessage = "Failed to start recording. " + e;
      Log.e(TAG, errorMessage, e);
      messageSnackbarHelper.showError(this, errorMessage);
      closeCaptureWriterQuietly();
      return;
    }
    if (session.getRecordingStatus() != RecordingStatus.OK) {
      logAndShowErrorMessage(
          "Failed to start recording, recording status is " + session.getRecordingStatus());
      closeCaptureWriterQuietly();
      return;
    }
    setStateAndUpdateUI(AppState.RECORDING);
  }

  /** Performs action when stop_recording button is clicked. */
  private void stopRecording() {
    try {
      session.stopRecording();
    } catch (RecordingFailedException e) {
      String errorMessage = "Failed to stop recording. " + e;
      Log.e(TAG, errorMessage, e);
      messageSnackbarHelper.showError(this, errorMessage);
      closeCaptureWriterQuietly();
      return;
    }
    if (session.getRecordingStatus() == RecordingStatus.OK) {
      logAndShowErrorMessage(
          "Failed to stop recording, recording status is " + session.getRecordingStatus());
      closeCaptureWriterQuietly();
      return;
    }
    if (captureWriter != null) {
      try {
        captureWriter.finish(/* arcoreVersionHint= */ "com.google.ar:core:1.56.0");
        captureWriter.close();
      } catch (IOException e) {
        Log.e(TAG, "Failed to finalize capture package", e);
        messageSnackbarHelper.showError(this, "Failed to write manifest.json: " + e.getMessage());
      }
      captureWriter = null;
    }
    if (new File(lastRecordingDatasetPath).exists()) {
      playbackDatasetPath = lastRecordingDatasetPath;
      File captureDir = new File(lastRecordingDatasetPath).getParentFile();
      Log.d(TAG, "p2D capture saved at: " + captureDir);
      messageSnackbarHelper.showMessageForShortDuration(
          this,
          "Saved: "
              + captureDir.getName()
              + " ("
              + uiSnapCount
              + " snaps)");
    } else {
      logAndShowErrorMessage(
          "Recording failed. File " + lastRecordingDatasetPath + " wasn't created.");
    }
    setStateAndUpdateUI(AppState.IDLE);
  }

  private void closeCaptureWriterQuietly() {
    if (captureWriter != null) {
      try {
        captureWriter.close();
      } catch (IOException ignored) {
      }
      captureWriter = null;
    }
  }

  /** Helper function to log error message and show it on the screen. */
  private void logAndShowErrorMessage(String errorMessage) {
    Log.e(TAG, errorMessage);
    messageSnackbarHelper.showError(this, errorMessage);
  }

  /** Helper function to set state and update UI. */
  private void setStateAndUpdateUI(AppState state) {
    currentState.set(state);
    updateUI();
  }

  /** Performs action when playback button is clicked. */
  private void startPlayback() {
    if (playbackDatasetPath == null) {
      return;
    }
    currentState.set(AppState.PLAYBACK);
    restartActivityWithIntentExtras();
  }

  /** Performs action when close_playback button is clicked. */
  private void stopPlayback() {
    currentState.set(AppState.IDLE);
    restartActivityWithIntentExtras();
  }

  /** Checks the playback is in progress without issues. */
  private void checkPlaybackStatus() {
    if ((session.getPlaybackStatus() != PlaybackStatus.OK)
        && (session.getPlaybackStatus() != PlaybackStatus.FINISHED)) {
      logAndShowErrorMessage(
          "Failed to start playback, playback status is: " + session.getPlaybackStatus());
      setStateAndUpdateUI(AppState.IDLE);
    }
  }

  /**
   * Restarts current activity to enter or exit playback mode.
   *
   * <p>This method simulates an app with separate activities for recording and playback by
   * restarting the current activity and passing in the desired app state via an intent with extras.
   */
  private void restartActivityWithIntentExtras() {
    Intent intent = this.getIntent();
    Bundle bundle = new Bundle();
    bundle.putString(DESIRED_APP_STATE_KEY, currentState.get().name());
    bundle.putString(DESIRED_DATASET_PATH_KEY, playbackDatasetPath);
    intent.putExtras(bundle);
    this.finish();
    this.startActivity(intent);
  }

  /** Loads desired state from intent extras, if available. */
  private void loadInternalStateFromIntentExtras() {
    if (getIntent() == null || getIntent().getExtras() == null) {
      return;
    }
    Bundle bundle = getIntent().getExtras();
    if (bundle.containsKey(DESIRED_DATASET_PATH_KEY)) {
      playbackDatasetPath = getIntent().getStringExtra(DESIRED_DATASET_PATH_KEY);
    }
    if (bundle.containsKey(DESIRED_APP_STATE_KEY)) {
      String state = getIntent().getStringExtra(DESIRED_APP_STATE_KEY);
      if (state != null) {
        switch (state) {
          case "PLAYBACK":
            currentState.set(AppState.PLAYBACK);
            break;
          case "IDLE":
            currentState.set(AppState.IDLE);
            break;
          case "RECORDING":
            currentState.set(AppState.RECORDING);
            break;
          default:
            break;
        }
      }
    }
  }

  private String[] getPermissionsForTargetSDK() {
    int targetSdkVersion = this.getApplicationInfo().targetSdkVersion;
    int buildSdkVersion = Build.VERSION.SDK_INT;
    return targetSdkVersion >= VERSION_CODES.TIRAMISU && buildSdkVersion >= VERSION_CODES.TIRAMISU
        ? REQUIRED_PERMISSIONS_FOR_ANDROID_T_AND_ABOVE
        : REQUIRED_PERMISSIONS_FOR_ANDROID_S_AND_BELOW;
  }
}
