package local.p2d.capture;

import android.content.Context;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;

/** Reads device azimuth (degrees from north) when a rotation vector sensor is available. */
public final class FacingSensor implements SensorEventListener {
  private final SensorManager sensorManager;
  private final Sensor rotationSensor;
  private final float[] rotationMatrix = new float[9];
  private final float[] orientation = new float[3];
  private volatile Float azimuthDeg = null;

  public FacingSensor(Context context) {
    sensorManager = (SensorManager) context.getSystemService(Context.SENSOR_SERVICE);
    rotationSensor =
        sensorManager == null
            ? null
            : sensorManager.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR);
  }

  public void start() {
    if (sensorManager != null && rotationSensor != null) {
      sensorManager.registerListener(this, rotationSensor, SensorManager.SENSOR_DELAY_GAME);
    }
  }

  public void stop() {
    if (sensorManager != null) {
      sensorManager.unregisterListener(this);
    }
  }

  /** Compass facing string, or null if sensor not ready. */
  public String currentFacingOrNull() {
    Float az = azimuthDeg;
    if (az == null) {
      return null;
    }
    return CaptureSessionWriter.facingFromYawDeg(az);
  }

  @Override
  public void onSensorChanged(SensorEvent event) {
    if (event.sensor.getType() != Sensor.TYPE_ROTATION_VECTOR) {
      return;
    }
    SensorManager.getRotationMatrixFromVector(rotationMatrix, event.values);
    SensorManager.getOrientation(rotationMatrix, orientation);
    // orientation[0] = azimuth, radians, -π..π, 0 = north
    float az = (float) Math.toDegrees(orientation[0]);
    if (az < 0) {
      az += 360f;
    }
    azimuthDeg = az;
  }

  @Override
  public void onAccuracyChanged(Sensor sensor, int accuracy) {}
}
