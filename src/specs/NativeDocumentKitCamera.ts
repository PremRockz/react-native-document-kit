import type {TurboModule} from 'react-native';
import {TurboModuleRegistry} from 'react-native';

/** A photo DocumentKit's camera saved into the app cache. */
export type NativeCapturedPhoto = {
  /** file:// URI of the full-resolution JPEG. */
  uri: string;
  /** "Image_<timestamp>.jpg" */
  name: string;
  mimeType: string;
  size: number;
  /** As displayed (EXIF orientation applied). */
  width?: number;
  height?: number;
  /** Screen-sized, upright JPEG of the same photo, for showing it without decoding the full file. */
  previewUri: string;
};

/** A recording DocumentKit's camera saved into the app cache (MP4, H.264). */
export type NativeCapturedVideo = {
  uri: string;
  /** "Video_<timestamp>.mp4" */
  name: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  durationMs?: number;
  /** Screen-sized JPEG of the first frame. */
  posterUri: string;
};

/** A rectangle in fractions (0–1) of a photo as shown. */
export type NativeCropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** The review editor's changes to a photo, applied in this order. */
export type NativePhotoEdits = {
  /** 0, 90, 180 or 270, clockwise. */
  rotationDegrees: number;
  /** Mirrored left to right, after the rotation. */
  isFlipped: boolean;
  /** Fine turn, −45 to 45 clockwise, after the flip; zoomed in so no corner is empty. */
  straightenDegrees: number;
  /** Fractions (0–1) of the photo after the steps above. */
  crop: NativeCropRect;
};

export type NativeRecordingOptions = {
  /** False records without sound (microphone refused). */
  isAudioEnabled: boolean;
  /** Stops on its own after this long; 0 means no limit. */
  maxDurationSeconds: number;
};

/**
 * DocumentKit's own camera (docs/CAMERA_PLAN.md). Works with a mounted
 * DocumentKitCameraView, found by its `cameraId`.
 *
 * Rejection codes: E_NOT_READY (no such camera, or it is not running),
 * E_BUSY (a photo or recording is already in progress), E_CAPTURE, E_STORAGE,
 * E_CANCELLED (recording cancelled).
 */
export interface Spec extends TurboModule {
  /**
   * Starts the camera stack before the camera screen mounts, so its preview
   * appears sooner. `position` is "back" or "front".
   * Android: starts CameraX for the process. iOS: builds the capture session
   * with that camera, which the next DocumentKitCameraView takes over (released
   * after a few seconds if no screen opens).
   * Never prompts: without camera permission it does nothing. Resolves when ready.
   */
  prewarm(position: string): Promise<void>;
  /**
   * Takes a photo. `flash` is "off", "on" or "auto". The preview freezes on
   * the shot until resumePreview or the view goes away.
   */
  takePhoto(cameraId: string, flash: string): Promise<NativeCapturedPhoto>;
  /** Unfreezes the preview after takePhoto, to take another (multi-capture). */
  resumePreview(cameraId: string): void;
  /**
   * Starts recording and resolves when the recording ends: stopRecording, the
   * duration limit, or an interruption (the file so far is kept). Rejects
   * E_CANCELLED after cancelRecording.
   */
  startRecording(
    cameraId: string,
    options: NativeRecordingOptions,
  ): Promise<NativeCapturedVideo>;
  stopRecording(cameraId: string): void;
  pauseRecording(cameraId: string): void;
  resumeRecording(cameraId: string): void;
  /** Ends the recording and deletes it. */
  cancelRecording(cameraId: string): void;
  /** Clamped to the camera's range; below 1 switches to the ultra-wide lens where there is one. */
  setZoom(cameraId: string, zoom: number): void;
  /**
   * Writes an edited copy of a photo from takePhoto (see NativePhotoEdits).
   * Rotation and flip alone only rewrite the orientation metadata; a crop
   * decodes just its region; straightening redraws the pixels. Needs no camera
   * view. The original is kept. Rejects E_STORAGE.
   */
  editPhoto(uri: string, edits: NativePhotoEdits): Promise<NativeCapturedPhoto>;
}

// get, not getEnforcing: the camera rewrite is experimental, and an app binary
// built before this module must still start with the newer JS.
export default TurboModuleRegistry.get<Spec>('DocumentKitCamera');
