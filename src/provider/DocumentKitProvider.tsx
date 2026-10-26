import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {Keyboard, Platform} from 'react-native';
import {CameraCaptureModal} from '../camera/CameraCaptureModal';
import {LibraryReviewModal, isReviewablePhoto} from '../camera/LibraryReview';
import type {LibraryReviewSession} from '../camera/LibraryReview';
import {
  ensureCameraPermission,
  ensureMicrophonePermission,
} from '../camera/cameraPermission';
import type {CameraPermissionResult} from '../camera/cameraPermission';
import {
  DEFAULT_CAMERA_LABELS,
  DEFAULT_CAMERA_THEME,
  resolveReviewOptions,
} from '../camera/types';
import type {
  CameraMode,
  CameraPosition,
  CameraReviewOptions,
  CameraSession,
  CameraTimingMark,
  CameraTimingReporter,
  DocumentKitCameraLabels,
  DocumentKitCameraTheme,
} from '../camera/types';
import {isNativeCameraAvailable, prewarmNativeCamera} from '../camera/nativeCamera';
import {detectRecordingQuality} from '../core/network';
import type {RecordingQuality} from '../core/network';
import type {DocumentKitErrorReporter, PickResult} from '../core/types';
import {
  captureWithSystemCamera,
  pickFromSystemLibrary,
  pickSystemDocuments,
  resolveSelectionLimit,
} from '../media/systemMedia';
import type {
  PickDocumentsOptions,
  PickFromLibraryOptions,
  RecordVideoOptions,
} from '../media/systemMedia';
import {openPreview as openPreviewScreen} from '../preview/preview';
import type {
  PreviewOptions,
  PreviewResult,
  PreviewSource,
} from '../preview/preview';
import {setDefaultUnauthorizedHandler} from '../core/unauthorized';
import type {UnauthorizedHandler} from '../core/unauthorized';
import {PreviewLoadingOverlay} from '../preview/PreviewLoadingOverlay';
import type {
  PreviewLoadingLabels,
  PreviewLoadingTheme,
} from '../preview/PreviewLoadingOverlay';

export interface OpenCameraOptions {
  /** Modes offered; more than one shows the Photo / Video switch. Defaults to ['photo']. */
  modes?: CameraMode[];
  /** Defaults to the first mode. */
  initialMode?: CameraMode;
  /** Applies when video is one of the modes. */
  video?: RecordVideoOptions;
  /**
   * Several captures at once: the camera stays open after each one, with a
   * thumbnail, the multi-capture review and Done. Defaults to false; false
   * always takes one.
   */
  allowMultiple?: boolean;
  /**
   * The most captures with allowMultiple; defaults to 10. A value above 1 alone
   * (without allowMultiple) also turns multiple captures on.
   */
  maxFiles?: number;
  /** The review screen after each capture; every part is on by default. */
  review?: CameraReviewOptions;
  /**
   * Cameras the user may use. Defaults to ['back', 'front']; one entry hides the
   * front/back switch. If the device lacks the camera it opens on, it moves to
   * the other one when allowed.
   */
  positions?: CameraPosition[];
  /** Defaults to the first of positions (back by default). */
  initialPosition?: CameraPosition;
  /** Pinch zoom and the 0.5× / 1× / 2× lens buttons. Defaults to true. */
  allowZoom?: boolean;
  /** The flash button (the torch in video mode). Defaults to true; false keeps the flash off. */
  allowFlash?: boolean;
}

const ALL_POSITIONS: CameraPosition[] = ['back', 'front'];

// allowMultiple without a maxFiles: enough for a typical batch, without filling the cache.
const DEFAULT_MULTIPLE_MAX_FILES = 10;

/** 1 unless several captures are allowed: allowMultiple (with maxFiles or 10), or maxFiles above 1. */
const resolveMaxFiles = ({allowMultiple, maxFiles}: OpenCameraOptions): number => {
  if (allowMultiple === false) {
    return 1;
  }
  const limit = maxFiles ?? (allowMultiple ? DEFAULT_MULTIPLE_MAX_FILES : 1);
  return Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : DEFAULT_MULTIPLE_MAX_FILES;
};

/**
 * openCamera's options for capturePhoto and recordVideo, which fix the mode:
 * maxFiles, review, positions, initialPosition, allowZoom, allowFlash.
 */
export type CaptureOptions = Omit<OpenCameraOptions, 'modes' | 'initialMode' | 'video'>;

/** openPreview options from the hook; the provider adds the labels and progress overlay. */
export type OpenPreviewOptions = Pick<PreviewOptions, 'save' | 'muted' | 'player'>;

/** Every method resolves a PickResult and never rejects. */
export interface DocumentKitApi {
  /**
   * In-app camera for photos, videos or both. Asks for camera permission (and
   * the microphone for video; without it video records without sound).
   */
  openCamera: (options?: OpenCameraOptions) => Promise<PickResult>;
  /** In-app camera locked to photos. Takes openCamera's other options, e.g. {maxFiles: 10}. */
  capturePhoto: (options?: CaptureOptions) => Promise<PickResult>;
  /**
   * In-app camera locked to video. MP4/H.264, quality from the network by
   * default. Takes openCamera's other options too, e.g. {maxFiles: 3}.
   */
  recordVideo: (options?: RecordVideoOptions & CaptureOptions) => Promise<PickResult>;
  /** OS camera app. Use when the in-app camera reports no camera device. */
  capturePhotoWithSystemCamera: () => Promise<PickResult>;
  /** Records with the OS camera app; always delivered as MP4. */
  recordVideoWithSystemCamera: (options?: RecordVideoOptions) => Promise<PickResult>;
  /** System photo picker; needs no permission. iOS HEIC arrives as JPEG. */
  pickFromLibrary: (options?: PickFromLibraryOptions) => Promise<PickResult>;
  /** Files app / system file picker; needs no permission. Keeps the original file name. */
  pickDocuments: (options?: PickDocumentsOptions) => Promise<PickResult>;
  /**
   * Optional: call when a screen with a camera button appears, so the in-app
   * camera opens faster. Never prompts; does nothing without camera permission.
   * openCamera pre-warms on its own too.
   */
  prewarmCamera: () => void;
  /**
   * In-app, full-screen preview. Video/audio stream; documents download into
   * DocumentKit's private cache first, behind a cancellable progress overlay that
   * only appears when a download is actually needed.
   */
  openPreview: (
    source: PreviewSource,
    options?: OpenPreviewOptions,
  ) => Promise<PreviewResult>;
}

export interface DocumentKitPreviewLabels extends PreviewLoadingLabels {
  /** Accessibility label of the preview screens' close button. */
  previewClose: string;
  /** Shown when a video or audio stream cannot play. */
  playbackError: string;
  /** Save button in Android's image and PDF viewers. */
  previewSave: string;
  previewSaved: string;
  previewSaveFailed: string;
  /** Above a text file too large to show in full (Android). */
  previewTruncated: string;
  /** Accessibility labels of the video/audio player's buttons. */
  previewMute: string;
  previewUnmute: string;
  previewPlay: string;
  previewPause: string;
  previewSeekBack: string;
  previewSeekForward: string;
  previewPlaybackSpeed: string;
  previewFullScreen: string;
  previewExitFullScreen: string;
}

export type DocumentKitLabels = DocumentKitCameraLabels & DocumentKitPreviewLabels;

/** The "Opening file…" card shown while a document downloads before its viewer opens. */
export type DocumentKitPreviewTheme = Omit<PreviewLoadingTheme, 'primaryColor' | 'fontFamily'>;

/** Colours and font of DocumentKit's screens; anything left out keeps its default. */
export type DocumentKitTheme = DocumentKitCameraTheme & DocumentKitPreviewTheme;

export interface DocumentKitProviderProps {
  children: React.ReactNode;
  theme?: Partial<DocumentKitTheme>;
  labels?: Partial<DocumentKitLabels>;
  onError?: DocumentKitErrorReporter;
  /**
   * Called when a server answers 401 or 403 to any DocumentKit request
   * (openPreview, downloadFile, video streams). Return fresh headers, e.g. a
   * renewed session cookie, and the request is retried once; return null to give
   * up, and the call resolves with reason 'unauthorized'.
   */
  onUnauthorized?: UnauthorizedHandler;
  /**
   * Starts the camera while the permission prompts and the screen opening run,
   * so the preview appears sooner (docs/CAMERA_PLAN.md §3). Defaults to true;
   * false is for measuring its effect.
   */
  cameraPrewarm?: boolean;
  /** Each step of a camera session with its time since openCamera, to measure speed. */
  onCameraTiming?: CameraTimingReporter;
}

const DocumentKitContext = createContext<DocumentKitApi | null>(null);

const BUSY_PICK_RESULT: PickResult = {status: 'error', code: 'busy'};
const BUSY_PREVIEW_RESULT: PreviewResult = {status: 'busy'};

const DEFAULT_LABELS: DocumentKitLabels = {
  ...DEFAULT_CAMERA_LABELS,
  preparingPreview: 'Opening file…',
  cancel: 'Cancel',
  previewClose: 'Close',
  playbackError: 'This file cannot be played.',
  previewSave: 'Save',
  previewSaved: 'Saved to Downloads',
  previewSaveFailed: 'Could not save the file',
  previewTruncated: 'This file is large, so only its beginning is shown.',
  previewMute: 'Mute',
  previewUnmute: 'Unmute',
  previewPlay: 'Play',
  previewPause: 'Pause',
  previewSeekBack: 'Back {seconds} seconds',
  previewSeekForward: 'Forward {seconds} seconds',
  previewPlaybackSpeed: 'Playback speed',
  previewFullScreen: 'Full screen',
  previewExitFullScreen: 'Exit full screen',
};

const DEFAULT_THEME: DocumentKitTheme = {
  ...DEFAULT_CAMERA_THEME,
  previewBackdropColor: 'rgba(0, 0, 0, 0.45)',
  previewCardColor: '#FFFFFF',
  previewTitleColor: '#111827',
  previewTextColor: '#6B7280',
  previewTrackColor: '#E5E7EB',
};

const toPlayerLabels = (labels: DocumentKitLabels) => {
  return {
    close: labels.previewClose,
    playbackError: labels.playbackError,
    save: labels.previewSave,
    saved: labels.previewSaved,
    saveFailed: labels.previewSaveFailed,
    truncated: labels.previewTruncated,
    mute: labels.previewMute,
    unmute: labels.previewUnmute,
    play: labels.previewPlay,
    pause: labels.previewPause,
    seekBack: labels.previewSeekBack,
    seekForward: labels.previewSeekForward,
    playbackSpeed: labels.previewPlaybackSpeed,
    fullScreen: labels.previewFullScreen,
    exitFullScreen: labels.previewExitFullScreen,
  };
};

// Fallback in case iOS never reports the overlay as dismissed.
const OVERLAY_DISMISS_TIMEOUT_MS = 700;

interface PreviewOverlayState {
  fileName: string;
  fraction: number | null;
}

const toBlockedPickResult = (
  permission: Exclude<CameraPermissionResult, {status: 'granted'}>,
): PickResult =>
  permission.status === 'denied'
    ? {status: 'permission_denied', isBlocked: permission.isBlocked}
    : {status: 'unavailable', reason: 'no_camera_device'};

/**
 * Hosts the single in-app camera for the whole app. Mount once near the root,
 * inside whatever provides the theme and translations.
 */
export const DocumentKitProvider: React.FC<DocumentKitProviderProps> = ({
  children,
  theme,
  labels,
  onError,
  onUnauthorized,
  cameraPrewarm = true,
  onCameraTiming,
}) => {
  const [cameraSession, setCameraSession] = useState<CameraSession | null>(null);
  const [libraryReview, setLibraryReview] = useState<LibraryReviewSession | null>(null);
  const [previewOverlay, setPreviewOverlay] = useState<PreviewOverlayState | null>(null);
  // One picker at a time across every source.
  const isBusyRef = useRef(false);
  const resolveCaptureRef = useRef<((result: PickResult) => void) | null>(null);
  const resolveLibraryReviewRef = useRef<((result: PickResult) => void) | null>(null);
  const isMountedRef = useRef(true);

  // Read through a ref so an inline onError from the host does not change the
  // context value on every render.
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const onCameraTimingRef = useRef(onCameraTiming);
  useEffect(() => {
    onCameraTimingRef.current = onCameraTiming;
  }, [onCameraTiming]);

  const onUnauthorizedRef = useRef(onUnauthorized);
  useEffect(() => {
    onUnauthorizedRef.current = onUnauthorized;
  }, [onUnauthorized]);

  // Stable while the theme prop is, so the screens don't rebuild their styles
  // on every preview progress update.
  const resolvedTheme = useMemo<DocumentKitTheme>(
    () => ({...DEFAULT_THEME, ...theme}),
    [theme],
  );
  const resolvedLabels: DocumentKitLabels = {...DEFAULT_LABELS, ...labels};
  // Latest labels and theme for openPreview without changing the context value on every render.
  const labelsRef = useRef(resolvedLabels);
  const themeRef = useRef(resolvedTheme);
  useEffect(() => {
    labelsRef.current = resolvedLabels;
    themeRef.current = resolvedTheme;
  });

  const previewAbortRef = useRef<AbortController | null>(null);
  const isPreviewOverlayVisibleRef = useRef(false);
  const resolveOverlayDismissRef = useRef<(() => void) | null>(null);

  const reportError = useCallback<DocumentKitErrorReporter>((error, context) => {
    onErrorRef.current?.(error, context);
  }, []);

  // Every DocumentKit call (also downloadFile outside React) uses the latest onUnauthorized.
  useEffect(() => {
    setDefaultUnauthorizedHandler(async request => {
      const handler = onUnauthorizedRef.current;
      if (!handler) {
        return null;
      }
      try {
        return await handler(request);
      } catch (error) {
        reportError(error, {operation: 'session_refresh'});
        return null;
      }
    });
    return () => setDefaultUnauthorizedHandler(null);
  }, [reportError]);

  const reportCameraTiming = useCallback<CameraTimingReporter>(timing => {
    onCameraTimingRef.current?.(timing);
  }, []);

  // Idempotent: the camera can report more than once (e.g. close tapped twice
  // during the dismiss animation); only the first result is delivered.
  const settleCapture = useCallback((result: PickResult) => {
    const resolveCapture = resolveCaptureRef.current;
    resolveCaptureRef.current = null;
    if (isMountedRef.current) {
      setCameraSession(null);
    }
    resolveCapture?.(result);
  }, []);

  // Idempotent, like settleCapture.
  const settleLibraryReview = useCallback((result: PickResult) => {
    const resolve = resolveLibraryReviewRef.current;
    resolveLibraryReviewRef.current = null;
    if (isMountedRef.current) {
      setLibraryReview(null);
    }
    resolve?.(result);
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      settleCapture({status: 'cancelled'});
      settleLibraryReview({status: 'cancelled'});
    };
  }, [settleCapture, settleLibraryReview]);

  const runExclusive = useCallback(
    async <T,>(task: () => Promise<T>, busyResult: T): Promise<T> => {
      if (isBusyRef.current) {
        return busyResult;
      }
      isBusyRef.current = true;
      Keyboard.dismiss();
      try {
        return await task();
      } finally {
        isBusyRef.current = false;
      }
    },
    [],
  );

  const withCameraPermission = useCallback(
    async (start: () => Promise<PickResult>): Promise<PickResult> => {
      let permission: CameraPermissionResult;
      try {
        permission = await ensureCameraPermission();
      } catch (error) {
        reportError(error, {operation: 'camera_permission'});
        return {status: 'error', code: 'permission_check_failed'};
      }
      return permission.status === 'granted'
        ? start()
        : toBlockedPickResult(permission);
    },
    [reportError],
  );

  const resolveVideoQuality = useCallback(
    (quality: RecordVideoOptions['quality']): Promise<RecordingQuality> =>
      quality && quality !== 'auto'
        ? Promise.resolve(quality)
        : detectRecordingQuality(reportError),
    [reportError],
  );

  /** Microphone is optional: without it video records without sound. */
  const isMicrophoneAllowed = useCallback(async (): Promise<boolean> => {
    try {
      return await ensureMicrophonePermission();
    } catch (error) {
      reportError(error, {operation: 'microphone_permission'});
      return false;
    }
  }, [reportError]);

  const showCamera = useCallback((session: CameraSession): Promise<PickResult> => {
    // The provider may have unmounted while a permission prompt was open.
    if (!isMountedRef.current) {
      return Promise.resolve({status: 'cancelled'});
    }
    return new Promise<PickResult>(resolve => {
      resolveCaptureRef.current = resolve;
      setCameraSession(session);
    });
  }, []);

  const openCamera = useCallback(
    (options: OpenCameraOptions = {}) =>
      runExclusive(() => {
        // An app binary built before DocumentKit's camera: the caller falls back to the OS camera.
        if (!isNativeCameraAvailable()) {
          return Promise.resolve<PickResult>({status: 'unavailable', reason: 'no_camera_device'});
        }
        const openedAt = Date.now();
        const modes: CameraMode[] = options.modes?.length ? options.modes : ['photo'];
        const hasVideo = modes.includes('video');
        const markTiming = (mark: CameraTimingMark) =>
          reportCameraTiming({mark, elapsedMs: Date.now() - openedAt});
        markTiming('open');
        // Read the network while the permission prompts are open, not after them.
        // Never rejects: a failed read falls back to medium.
        const videoQuality: Promise<RecordingQuality> = hasVideo
          ? resolveVideoQuality(options.video?.quality)
          : Promise.resolve('medium');
        // Known values only, each once, in the caller's order.
        const positions = (options.positions ?? []).filter(
          (position, index, list) => ALL_POSITIONS.includes(position) && list.indexOf(position) === index,
        );
        const allowedPositions = positions.length > 0 ? positions : ALL_POSITIONS;
        const initialPosition =
          options.initialPosition && allowedPositions.includes(options.initialPosition)
            ? options.initialPosition
            : allowedPositions[0];
        return withCameraPermission(async () => {
          // Not before: on iOS, touching the camera without permission shows the prompt.
          // Runs during the microphone prompt and the screen opening; not awaited.
          if (cameraPrewarm) {
            void prewarmNativeCamera(reportError, initialPosition).then(isDone => {
              if (isDone) {
                markTiming('prewarm_done');
              }
            });
          }
          const initialMode =
            options.initialMode && modes.includes(options.initialMode)
              ? options.initialMode
              : modes[0];
          const wantsAudio = hasVideo && options.video?.audio !== false;
          const isAudioEnabled = wantsAudio ? await isMicrophoneAllowed() : false;
          const session: CameraSession = {
            openedAt,
            modes,
            initialMode,
            isAudioEnabled,
            videoQuality: await videoQuality,
            maxDurationSeconds: Math.max(0, Math.floor(options.video?.maxDurationSeconds ?? 0)),
            maxFiles: resolveMaxFiles(options),
            positions: allowedPositions,
            initialPosition,
            isZoomEnabled: options.allowZoom ?? true,
            isFlashEnabled: options.allowFlash ?? true,
            review: resolveReviewOptions(options.review),
          };
          markTiming('permissions_done');
          return showCamera(session);
        });
      }, BUSY_PICK_RESULT),
    [
      runExclusive,
      withCameraPermission,
      showCamera,
      isMicrophoneAllowed,
      resolveVideoQuality,
      reportCameraTiming,
      reportError,
      cameraPrewarm,
    ],
  );

  const prewarmCamera = useCallback(() => {
    if (cameraPrewarm) {
      void prewarmNativeCamera(reportError);
    }
  }, [cameraPrewarm, reportError]);

  const capturePhoto = useCallback(
    (options: CaptureOptions = {}) => openCamera({...options, modes: ['photo']}),
    [openCamera],
  );

  const recordVideo = useCallback(
    ({quality, maxDurationSeconds, audio, ...camera}: RecordVideoOptions & CaptureOptions = {}) =>
      openCamera({...camera, modes: ['video'], video: {quality, maxDurationSeconds, audio}}),
    [openCamera],
  );

  const capturePhotoWithSystemCamera = useCallback(
    () =>
      runExclusive(
        () =>
          withCameraPermission(() =>
            captureWithSystemCamera('photo', {}, reportError),
          ),
        BUSY_PICK_RESULT,
      ),
    [runExclusive, withCameraPermission, reportError],
  );

  const recordVideoWithSystemCamera = useCallback(
    (options: RecordVideoOptions = {}) =>
      runExclusive(() => {
        // Read the network while the permission prompt is open, not after it.
        const quality = resolveVideoQuality(options.quality);
        return withCameraPermission(async () =>
          captureWithSystemCamera(
            'video',
            {...options, quality: await quality},
            reportError,
          ),
        );
      }, BUSY_PICK_RESULT),
    [runExclusive, withCameraPermission, resolveVideoQuality, reportError],
  );

  const pickFromLibrary = useCallback(
    (options: PickFromLibraryOptions = {}) =>
      runExclusive(async () => {
        const result = await pickFromSystemLibrary(options, reportError);
        // The review is for photos; a pick with a video or GIF comes back as it is.
        if (
          !options.review ||
          !isMountedRef.current ||
          result.status !== 'picked' ||
          !result.files.every(isReviewablePhoto)
        ) {
          return result;
        }
        return new Promise<PickResult>(resolve => {
          resolveLibraryReviewRef.current = resolve;
          setLibraryReview({
            files: result.files,
            review: resolveReviewOptions(options.review === true ? {} : options.review || {}),
            selectionLimit: resolveSelectionLimit(options),
          });
        });
      }, BUSY_PICK_RESULT),
    [runExclusive, reportError],
  );

  /** The library review's "Choose another" and "+": photos only, so the review can show them. */
  const pickMoreForReview = useCallback(
    async (limit: number) => {
      const result = await pickFromSystemLibrary({mediaType: 'photo', selectionLimit: limit}, reportError);
      return result.status === 'picked' ? result.files.filter(isReviewablePhoto) : [];
    },
    [reportError],
  );

  const pickDocuments = useCallback(
    (options: PickDocumentsOptions = {}) =>
      runExclusive(
        () => pickSystemDocuments(options, reportError),
        BUSY_PICK_RESULT,
      ),
    [runExclusive, reportError],
  );

  /** Resolves once the overlay is gone, so a native viewer can be presented. */
  const hidePreviewOverlay = useCallback((): Promise<void> => {
    if (!isPreviewOverlayVisibleRef.current) {
      return Promise.resolve();
    }
    isPreviewOverlayVisibleRef.current = false;
    return new Promise<void>(resolve => {
      if (Platform.OS === 'ios') {
        // iOS cannot present the viewer while the overlay is still closing.
        resolveOverlayDismissRef.current = resolve;
        setTimeout(resolve, OVERLAY_DISMISS_TIMEOUT_MS);
      } else {
        resolve();
      }
      if (isMountedRef.current) {
        setPreviewOverlay(null);
      }
    });
  }, []);

  const handleOverlayDismiss = useCallback(() => {
    resolveOverlayDismissRef.current?.();
    resolveOverlayDismissRef.current = null;
  }, []);

  const openPreview = useCallback(
    (source: PreviewSource, options: OpenPreviewOptions = {}) =>
      runExclusive(async () => {
        const controller = new AbortController();
        previewAbortRef.current = controller;
        try {
          return await openPreviewScreen(source, {
            labels: toPlayerLabels(labelsRef.current),
            save: options.save,
            muted: options.muted,
            player: options.player,
            accentColor: themeRef.current.primaryColor,
            signal: controller.signal,
            // Progress only arrives when a download is needed; cached files open directly.
            onProgress: progress => {
              if (controller.signal.aborted || !isMountedRef.current) {
                return;
              }
              isPreviewOverlayVisibleRef.current = true;
              setPreviewOverlay({fileName: source.name, fraction: progress.fraction});
            },
            beforePresent: hidePreviewOverlay,
          });
        } finally {
          previewAbortRef.current = null;
          await hidePreviewOverlay();
        }
      }, BUSY_PREVIEW_RESULT),
    [runExclusive, hidePreviewOverlay],
  );

  const cancelPreview = useCallback(() => {
    previewAbortRef.current?.abort();
  }, []);

  const api = useMemo<DocumentKitApi>(() => {
    return {
      openCamera,
      capturePhoto,
      recordVideo,
      capturePhotoWithSystemCamera,
      recordVideoWithSystemCamera,
      pickFromLibrary,
      pickDocuments,
      prewarmCamera,
      openPreview,
    };
  }, [
    openCamera,
    capturePhoto,
    recordVideo,
    capturePhotoWithSystemCamera,
    recordVideoWithSystemCamera,
    pickFromLibrary,
    pickDocuments,
    prewarmCamera,
    openPreview,
  ]);

  return (
    <DocumentKitContext.Provider value={api}>
      {children}
      <CameraCaptureModal
        session={cameraSession}
        theme={resolvedTheme}
        labels={resolvedLabels}
        playerLabels={toPlayerLabels(resolvedLabels)}
        onResult={settleCapture}
        reportError={reportError}
        reportTiming={reportCameraTiming}
      />
      <LibraryReviewModal
        session={libraryReview}
        theme={resolvedTheme}
        labels={resolvedLabels}
        playerLabels={toPlayerLabels(resolvedLabels)}
        onResult={settleLibraryReview}
        onPickMore={pickMoreForReview}
        reportError={reportError}
      />
      <PreviewLoadingOverlay
        visible={previewOverlay !== null}
        fileName={previewOverlay?.fileName ?? ''}
        fraction={previewOverlay?.fraction ?? null}
        theme={resolvedTheme}
        labels={resolvedLabels}
        onCancel={cancelPreview}
        onDismiss={handleOverlayDismiss}
      />
    </DocumentKitContext.Provider>
  );
};

export const useDocumentKit = (): DocumentKitApi => {
  const api = useContext(DocumentKitContext);
  if (!api) {
    throw new Error('useDocumentKit must be used inside <DocumentKitProvider>.');
  }
  return api;
};
