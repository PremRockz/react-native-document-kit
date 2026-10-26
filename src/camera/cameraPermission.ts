import NativeDocumentKitPermissions from '../specs/NativeDocumentKitPermissions';

export type CameraPermissionStatus =
  | 'granted'
  | 'promptable'
  | 'blocked'
  | 'unavailable';

export type CameraPermissionResult =
  | {status: 'granted'}
  | {status: 'denied'; isBlocked: boolean}
  | {status: 'unavailable'};

const CAMERA_PERMISSION_STATUSES: readonly string[] = [
  'granted',
  'promptable',
  'blocked',
  'unavailable',
] satisfies readonly CameraPermissionStatus[];

const isCameraPermissionStatus = (
  value: string,
): value is CameraPermissionStatus => CAMERA_PERMISSION_STATUSES.includes(value);

const parseStatus = (value: string): CameraPermissionStatus => {
  if (!isCameraPermissionStatus(value)) {
    throw new Error(`Unknown camera permission status from native: ${value}`);
  }
  return value;
};

/** Maps the status after a request; "promptable" here means the user said no. */
export const toCameraPermissionResult = (
  status: CameraPermissionStatus,
): CameraPermissionResult => {
  switch (status) {
    case 'granted':
      return {status: 'granted'};
    case 'blocked':
      return {status: 'denied', isBlocked: true};
    case 'unavailable':
      return {status: 'unavailable'};
    case 'promptable':
      return {status: 'denied', isBlocked: false};
  }
};

/**
 * Returns the camera permission, showing the OS prompt only when it still can.
 * The native side tells us when the permission is blocked, so no denied-count
 * bookkeeping is needed.
 */
export const ensureCameraPermission =
  async (): Promise<CameraPermissionResult> => {
    const status = parseStatus(
      await NativeDocumentKitPermissions.requestCameraPermission(),
    );
    return toCameraPermissionResult(status);
  };

/**
 * Asks for the microphone when the OS still can. Video records without sound
 * when this is false, so callers only need the boolean.
 */
export const ensureMicrophonePermission = async (): Promise<boolean> =>
  parseStatus(await NativeDocumentKitPermissions.requestMicrophonePermission()) ===
  'granted';

/**
 * Asks for notifications when the OS still can (Android 13+); older Android
 * reports the app's notification setting. Downloads work either way.
 */
export const ensureNotificationPermission = async (): Promise<boolean> =>
  parseStatus(await NativeDocumentKitPermissions.requestNotificationPermission()) ===
  'granted';

export const openAppSettings = (): Promise<void> =>
  NativeDocumentKitPermissions.openSettings();
