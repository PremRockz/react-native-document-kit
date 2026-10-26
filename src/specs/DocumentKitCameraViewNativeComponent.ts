import type {CodegenTypes, HostComponent, ViewProps} from 'react-native';
import {codegenNativeComponent} from 'react-native';

export type CameraPreviewStartedEvent = Readonly<{
  /** The current camera has a flash (or torch). */
  hasFlash: boolean;
}>;

export type CameraViewErrorEvent = Readonly<{
  /** "no_device" (no camera at this position) or "session_failed". */
  code: string;
  message: string;
}>;

export type CameraZoomEvent = Readonly<{
  zoom: CodegenTypes.Float;
  /** Below 1 when the device has an ultra-wide lens. */
  minZoom: CodegenTypes.Float;
  maxZoom: CodegenTypes.Float;
}>;

export type CameraRecordingProgressEvent = Readonly<{
  /** Recorded so far, pauses excluded. */
  seconds: CodegenTypes.Double;
  bytes: CodegenTypes.Double;
}>;

export type CameraOrientationEvent = Readonly<{
  /**
   * How far the phone is turned clockwise relative to the screen: 0, 90, 180 or 270.
   * 0 whenever the screen turned with the phone (iPad, apps that allow landscape).
   */
  degrees: CodegenTypes.Int32;
}>;

export type CameraSafeAreaEvent = Readonly<{
  top: CodegenTypes.Double;
  right: CodegenTypes.Double;
  bottom: CodegenTypes.Double;
  left: CodegenTypes.Double;
}>;

export type CameraSwipeEvent = Readonly<{
  /** "left" or "right": a horizontal swipe across the preview (switches mode). */
  direction: string;
}>;

export type CameraInterruptionEvent = Readonly<{
  /** True while the system has paused the camera; false once it is back. */
  isInterrupted: boolean;
  /**
   * "multitasking" (iPad Split View / Slide Over), "in_use" (another app or a
   * call has the camera), or "other". Empty when the camera is back.
   */
  reason: string;
}>;

export interface NativeProps extends ViewProps {
  /** Unique per mounted view; NativeDocumentKitCamera calls use it to find this camera. */
  cameraId: string;
  /**
   * Not `position`: React Native flattens style into the same props, so a prop
   * named `position` overwrites the layout style `position: 'absolute'`.
   */
  cameraPosition?: CodegenTypes.WithDefault<'back' | 'front', 'back'>;
  /**
   * Photo and video are normally both ready at once, so switching is instant.
   * On devices that cannot run both, only this mode's output is set up.
   */
  mode?: CodegenTypes.WithDefault<'photo' | 'video', 'photo'>;
  /** 1080p / 720p / 480p (next lower when the camera lacks it). */
  videoQuality?: CodegenTypes.WithDefault<'low' | 'medium' | 'high', 'medium'>;
  /** Target video bitrate; 0 lets the platform choose. */
  videoBitRateKbps?: CodegenTypes.WithDefault<CodegenTypes.Int32, 0>;
  /** Keeps the light on (video). */
  torch?: CodegenTypes.WithDefault<boolean, false>;
  /** False stops the camera (e.g. app in the background) without unmounting. */
  isActive?: CodegenTypes.WithDefault<boolean, true>;
  /** False turns pinch zoom off (the camera stays at its 1× lens). */
  isZoomEnabled?: CodegenTypes.WithDefault<boolean, true>;
  /** First frames are on screen; fires again after a camera switch or restart. */
  onPreviewStarted?: CodegenTypes.DirectEventHandler<CameraPreviewStartedEvent>;
  onCameraError?: CodegenTypes.DirectEventHandler<CameraViewErrorEvent>;
  /** After a camera starts and while zooming (pinch or setZoom). */
  onZoomChanged?: CodegenTypes.DirectEventHandler<CameraZoomEvent>;
  /** About once a second while recording. */
  onRecordingProgress?: CodegenTypes.DirectEventHandler<CameraRecordingProgressEvent>;
  /** Tells the UI how to turn its icons to stay upright. */
  onOrientationChanged?: CodegenTypes.DirectEventHandler<CameraOrientationEvent>;
  /** System bars and cutouts overlapping this view, in points. */
  onSafeAreaInsets?: CodegenTypes.DirectEventHandler<CameraSafeAreaEvent>;
  /** The preview handles its own touches (pinch, tap), so swipes are reported from native. */
  onSwipe?: CodegenTypes.DirectEventHandler<CameraSwipeEvent>;
  /** The system paused the camera (it resumes on its own); the preview is black meanwhile. */
  onInterruption?: CodegenTypes.DirectEventHandler<CameraInterruptionEvent>;
}

/**
 * DocumentKit's live camera (CameraX on Android, AVFoundation on iOS), with pinch
 * zoom and tap to focus. Capture goes through NativeDocumentKitCamera
 * (docs/CAMERA_PLAN.md).
 */
export default codegenNativeComponent<NativeProps>(
  'DocumentKitCameraView',
) as HostComponent<NativeProps>;
