import type {DocumentKitErrorReporter} from '../core/types';
import NativeDocumentKitCamera from '../specs/NativeDocumentKitCamera';
import type {
  NativeCapturedPhoto,
  NativeCapturedVideo,
  NativePhotoEdits,
  NativeRecordingOptions,
} from '../specs/NativeDocumentKitCamera';
import type {CameraPosition, FlashMode} from './types';

const NOT_IN_BUILD = 'DocumentKit camera module is not in this build';

/** False in an app binary built before DocumentKit's camera module was added. */
export const isNativeCameraAvailable = (): boolean => NativeDocumentKitCamera != null;

/** cancelRecording (or the camera closing) ended the recording; not an error to report. */
export const isRecordingCancelled = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  error.code === 'E_CANCELLED';

/**
 * Starts DocumentKit's native camera ahead of the camera screen, at the camera
 * the session opens on (back unless initialPosition says front). Resolves true when it finished; false when it failed
 * or the native module is not in this build. Never rejects: the camera works the
 * same without it, only slower.
 */
export const prewarmNativeCamera = async (
  reportError: DocumentKitErrorReporter,
  position: CameraPosition = 'back',
): Promise<boolean> => {
  if (!NativeDocumentKitCamera) {
    return false;
  }
  try {
    await NativeDocumentKitCamera.prewarm(position);
    return true;
  } catch (error) {
    reportError(error, {operation: 'camera_prewarm'});
    return false;
  }
};

/** Takes a photo with the mounted DocumentKitCameraView `cameraId`. Rejects on failure. */
export const takeNativePhoto = (
  cameraId: string,
  flash: FlashMode,
): Promise<NativeCapturedPhoto> =>
  NativeDocumentKitCamera
    ? NativeDocumentKitCamera.takePhoto(cameraId, flash)
    : Promise.reject(new Error(NOT_IN_BUILD));

/** Resolves when the recording ends (stop, limit, interruption); rejects E_CANCELLED after cancel. */
export const startNativeRecording = (
  cameraId: string,
  options: NativeRecordingOptions,
): Promise<NativeCapturedVideo> =>
  NativeDocumentKitCamera
    ? NativeDocumentKitCamera.startRecording(cameraId, options)
    : Promise.reject(new Error(NOT_IN_BUILD));

/** An edited copy of a photo from takePhoto (see NativePhotoEdits). Rejects on failure. */
export const editNativePhoto = (uri: string, edits: NativePhotoEdits): Promise<NativeCapturedPhoto> =>
  NativeDocumentKitCamera
    ? NativeDocumentKitCamera.editPhoto(uri, edits)
    : Promise.reject(new Error(NOT_IN_BUILD));

/** Fire-and-forget controls for the mounted camera `cameraId`. */
export const nativeCameraControls = (cameraId: string) => ({
  resumePreview: () => NativeDocumentKitCamera?.resumePreview(cameraId),
  stopRecording: () => NativeDocumentKitCamera?.stopRecording(cameraId),
  pauseRecording: () => NativeDocumentKitCamera?.pauseRecording(cameraId),
  resumeRecording: () => NativeDocumentKitCamera?.resumeRecording(cameraId),
  cancelRecording: () => NativeDocumentKitCamera?.cancelRecording(cameraId),
  setZoom: (zoom: number) => NativeDocumentKitCamera?.setZoom(cameraId, zoom),
});
