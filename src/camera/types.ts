import type {RecordingQuality} from '../core/network';

export interface DocumentKitCameraTheme {
  /** Fill/border colour of the confirm/retake buttons, the active mode, Done and the count badge. */
  primaryColor: string;
  /** Text and spinners drawn on primaryColor (Use Photo, Done, the active mode, the count badge). */
  onPrimaryColor: string;
  /** Close, flash, switch-camera, play/pause and remove icons, and the thumbnail border. */
  iconColor: string;
  /** Text over the camera and on the review screens (timer, modes, lens zoom, notices, durations). */
  textColor: string;
  /** Camera and review screens, and the review screens' button bar. */
  backgroundColor: string;
  /** Translucent pills over the preview: timer, mode switch, lens zoom, notices, remove buttons. */
  overlayColor: string;
  /** Shutter ring and photo shutter button. */
  shutterColor: string;
  /** Record button, stop button and the recording dot. */
  recordColor: string;
  /** The selected lens's zoom (e.g. "1×"). */
  activeZoomColor: string;
  /** Multi-capture tiles while their thumbnails load. */
  surfaceColor: string;
  /** Round play button on a recorded video. */
  playButtonColor: string;
  /** Dims a recording's first frame so the play button and its details stand out. */
  posterScrimColor: string;
  /** The "Saving photo…" pill shown while a capture is saved. */
  toastColor: string;
  /** Border of the review screens' Retake / Add more button. */
  outlineColor: string;
  /** Font for every text DocumentKit shows; the system font when unset. */
  fontFamily?: string;
}

export interface DocumentKitCameraLabels {
  takePhoto: string;
  retake: string;
  usePhoto: string;
  useVideo: string;
  close: string;
  toggleFlash: string;
  switchCamera: string;
  photoMode: string;
  videoMode: string;
  startRecording: string;
  stopRecording: string;
  pauseRecording: string;
  resumeRecording: string;
  playVideo: string;
  /** Shown in video mode when the video will have no sound (microphone off or not allowed). */
  recordingWithoutSound: string;
  /** Microphone on/off switch in video mode; read out with its on/off state. */
  recordSound: string;
  /** Shown while the system pauses the camera: iPad Split View / Slide Over, another app or a call, anything else. */
  cameraPausedMultitasking: string;
  cameraInUse: string;
  cameraPaused: string;
  /** Shown while a photo, or a stopped recording, is being saved. */
  savingPhoto: string;
  savingVideo: string;
  /** Review screen titles. */
  reviewPhoto: string;
  reviewVideo: string;
  /** Review screen button that opens the photo editor. */
  editPhoto: string;
  /** Photo editor: Cancel / Done (Done uses `done`), its tabs and tools. */
  cropCancel: string;
  crop: string;
  straighten: string;
  rotate: string;
  rotateLeft: string;
  rotateRight: string;
  flip: string;
  /** The free-form crop shape, next to 1:1, 4:3… */
  cropFree: string;
  /** Shown when the crop or rotation cannot be saved. */
  editFailed: string;
  /** Flash state, read out with toggleFlash. */
  flashOff: string;
  flashOn: string;
  flashAuto: string;
  /** Multi-capture: finishes with everything taken so far, shown as "Done (3)". */
  done: string;
  /** Multi-capture review titles: photos only, videos only, or both. */
  reviewPhotos: string;
  reviewVideos: string;
  reviewCaptures: string;
  /** Multi-capture: the "+" tile, back to the camera for more. */
  addMore: string;
  /** Multi-capture: the close button, back to the camera (nothing is lost). */
  backToCamera: string;
  /** Library review: the close button (the pick is cancelled). */
  closeReview: string;
  /** Library review of one photo: replaces Retake, opens the photo picker again. */
  chooseAnother: string;
  /** Multi-capture: the × on a thumbnail, and the delete button for the one shown. */
  removeCapture: string;
  deleteCapture: string;
  /** Multi-capture: screen-reader actions on a thumbnail, instead of dragging it. */
  moveEarlier: string;
  moveLater: string;
  /** Multi-capture: the main button. {count} is replaced with the number. */
  attachPhoto: string;
  attachPhotos: string;
  attachVideo: string;
  attachVideos: string;
  /** Photos and videos together. */
  attachFiles: string;
}

export const DEFAULT_CAMERA_THEME: DocumentKitCameraTheme = {
  primaryColor: '#1C6FE2',
  onPrimaryColor: '#FFFFFF',
  iconColor: '#FFFFFF',
  textColor: '#FFFFFF',
  backgroundColor: '#000000',
  overlayColor: 'rgba(0, 0, 0, 0.55)',
  shutterColor: '#FFFFFF',
  recordColor: '#E5383B',
  activeZoomColor: '#FFD60A',
  surfaceColor: '#1A1A1A',
  playButtonColor: 'rgba(255, 255, 255, 0.18)',
  posterScrimColor: 'rgba(0, 0, 0, 0.35)',
  toastColor: 'rgba(28, 37, 65, 0.92)',
  outlineColor: 'rgba(255, 255, 255, 0.35)',
};

export const DEFAULT_CAMERA_LABELS: DocumentKitCameraLabels = {
  takePhoto: 'Take photo',
  retake: 'Retake',
  usePhoto: 'Use Photo',
  useVideo: 'Use Video',
  close: 'Close camera',
  toggleFlash: 'Toggle flash',
  switchCamera: 'Switch camera',
  photoMode: 'Photo',
  videoMode: 'Video',
  startRecording: 'Start recording',
  stopRecording: 'Stop recording',
  pauseRecording: 'Pause recording',
  resumeRecording: 'Resume recording',
  playVideo: 'Play video',
  recordingWithoutSound: 'Recording without sound',
  recordSound: 'Record sound',
  cameraPausedMultitasking: 'The camera is paused while other apps share the screen',
  cameraInUse: 'Another app is using the camera',
  cameraPaused: 'The camera is paused',
  savingPhoto: 'Saving photo…',
  savingVideo: 'Saving video…',
  reviewPhoto: 'Review photo',
  reviewVideo: 'Review video',
  editPhoto: 'Crop & Rotate',
  cropCancel: 'Cancel',
  crop: 'Crop',
  straighten: 'Straighten',
  rotate: 'Rotate',
  rotateLeft: 'Left 90°',
  rotateRight: 'Right 90°',
  flip: 'Flip',
  cropFree: 'Free',
  editFailed: 'Could not edit the photo. Try again.',
  flashOff: 'Off',
  flashOn: 'On',
  flashAuto: 'Auto',
  done: 'Done',
  reviewPhotos: 'Review photos',
  reviewVideos: 'Review videos',
  reviewCaptures: 'Review captures',
  addMore: 'Add more',
  backToCamera: 'Back to camera',
  closeReview: 'Close',
  chooseAnother: 'Choose another',
  removeCapture: 'Remove',
  deleteCapture: 'Delete',
  moveEarlier: 'Move earlier',
  moveLater: 'Move later',
  attachPhoto: 'Attach 1 photo',
  attachPhotos: 'Attach {count} photos',
  attachVideo: 'Attach 1 video',
  attachVideos: 'Attach {count} videos',
  attachFiles: 'Attach {count} files',
};

export type CameraPosition = 'back' | 'front';
/** "auto" is for photos; video (torch) treats it as off. */
export type FlashMode = 'off' | 'on' | 'auto';
export type CameraMode = 'photo' | 'video';

export type CameraTimingMark =
  /** openCamera was called. */
  | 'open'
  /** Permissions granted and recording settings resolved; the screen opens next. */
  | 'permissions_done'
  /** The camera finished pre-warming. */
  | 'prewarm_done'
  /** The camera screen mounted. */
  | 'screen_shown'
  /** Live frames on screen; again after a camera switch. */
  | 'preview_started'
  | 'switch_camera'
  /** Photo shutter, or stop recording, pressed. */
  | 'shutter'
  /** The photo or recording file is ready. */
  | 'capture_done'
  /** Use Photo / Use Video pressed. */
  | 'confirm'
  /** The result is built; the camera closes. */
  | 'result_ready';

/** One step of a camera session, to measure the speed budgets in docs/CAMERA_PLAN.md. */
export interface CameraTiming {
  mark: CameraTimingMark;
  /** Milliseconds since openCamera was called. */
  elapsedMs: number;
}

export type CameraTimingReporter = (timing: CameraTiming) => void;

/** A crop shape: 'free', or width:height such as '1:1', '4:3', '16:9'. */
export type CropAspectRatio = 'free' | `${number}:${number}`;

/**
 * What the review screen after each capture offers; everything is on by
 * default. Photos get a "Crop & Rotate" button when any of crop, straighten
 * or rotate is on; it opens an editor with a tab for each.
 */
export interface CameraReviewOptions {
  /** false skips the review: each capture is used as soon as it is saved. */
  enabled?: boolean;
  /** Close button, title, and the file's name and size at the top. */
  header?: boolean;
  /** Crop tab: a frame the user drags, with the cropAspectRatios shapes. */
  crop?: boolean;
  /** Straighten tab: turn up to 45° either way; the photo zooms in so no corner is empty. */
  straighten?: boolean;
  /** Rotate tab: Left 90° and Right 90°. */
  rotate?: boolean;
  /** Rotate tab: Flip (mirror left to right). */
  flip?: boolean;
  /** Multi-capture: the delete button and the × on each thumbnail. */
  remove?: boolean;
  /** Multi-capture: the "+" tile that goes back to the camera for more (until maxFiles). */
  addMore?: boolean;
  /** Multi-capture: hold a thumbnail and drag it to change the order the captures are attached in. */
  reorder?: boolean;
  /**
   * Crop shapes offered, in order; the first is selected when the editor opens.
   * Defaults to ['free', '1:1', '4:3', '3:4', '16:9']. ['1:1'] forces square
   * crops; [] (or ['free'] alone) hides the shapes and crops free-form.
   */
  cropAspectRatios?: CropAspectRatio[];
}

export const DEFAULT_CROP_ASPECT_RATIOS: CropAspectRatio[] = ['free', '1:1', '4:3', '3:4', '16:9'];

/** Every part on unless switched off. */
export const resolveReviewOptions = (review: CameraReviewOptions = {}): Required<CameraReviewOptions> => ({
  enabled: review.enabled ?? true,
  header: review.header ?? true,
  crop: review.crop ?? true,
  straighten: review.straighten ?? true,
  rotate: review.rotate ?? true,
  flip: review.flip ?? true,
  remove: review.remove ?? true,
  addMore: review.addMore ?? true,
  reorder: review.reorder ?? true,
  cropAspectRatios: review.cropAspectRatios ?? DEFAULT_CROP_ASPECT_RATIOS,
});

/** Everything the camera screen needs to know for one session. */
export interface CameraSession {
  /** Date.now() when openCamera was called; timings are measured from here. */
  openedAt: number;
  modes: CameraMode[];
  initialMode: CameraMode;
  /** Recording quality, already resolved from the network or the caller. */
  videoQuality: RecordingQuality;
  /** False when the microphone is not allowed: video records without sound. */
  isAudioEnabled: boolean;
  /** 0 means no limit. */
  maxDurationSeconds: number;
  /** More than 1: the camera stays open after each capture. */
  maxFiles: number;
  review: Required<CameraReviewOptions>;
  /** Cameras the user may use; more than one shows the front/back switch. */
  positions: CameraPosition[];
  initialPosition: CameraPosition;
  /** Pinch zoom and the lens buttons. */
  isZoomEnabled: boolean;
  /** The flash button (torch in video mode). */
  isFlashEnabled: boolean;
}

/**
 * Bitrate per quality, for 1080p / 720p / 480p (the native camera picks the
 * resolution from the quality name). H.264 MP4 keeps every server and browser
 * able to play the result; lower tiers upload faster on slow networks: about
 * 45 / 19 / 7.5 MB per minute.
 */
export const VIDEO_SETTINGS: Record<RecordingQuality, {bitRateKbps: number}> = {
  high: {bitRateKbps: 6000},
  medium: {bitRateKbps: 2500},
  low: {bitRateKbps: 1000},
};
