import React, {useCallback, useEffect, useState} from 'react';
import {Animated, Keyboard, Modal, Platform, StyleSheet} from 'react-native';
import type {DocumentKitErrorReporter, PickResult} from '../core/types';
import type {
  NativeCapturedPhoto,
  NativeCapturedVideo,
  NativePhotoEdits,
} from '../specs/NativeDocumentKitCamera';
import type {NativePreviewLabels} from '../specs/NativeDocumentKitPreview';
import {buildCapturedFile} from './capturedFiles';
import {CameraViewfinder} from './CameraViewfinder';
import {editNativePhoto} from './nativeCamera';
import {isUnedited} from './photoEdits';
import {PhotoReview} from './PhotoReview';
import {ReviewTray} from './ReviewTray';
import type {TrayItem} from './ReviewTray';
import {FALLBACK_INSETS} from './styles';
import {VideoReview} from './VideoReview';
import type {
  CameraMode,
  CameraPosition,
  CameraSession,
  CameraTimingMark,
  CameraTimingReporter,
  DocumentKitCameraLabels,
  DocumentKitCameraTheme,
  FlashMode,
} from './types';

// Android 16 enforces edge-to-edge, so the modal must draw under the system bars.
const IS_ANDROID_16 = Platform.OS === 'android' && Platform.Version >= 36;

const OPEN_FADE_MS = 150;

interface CameraCaptureModalProps {
  /** The open session, or null when the camera is closed. */
  session: CameraSession | null;
  theme: DocumentKitCameraTheme;
  labels: DocumentKitCameraLabels;
  /** Labels for the native player used to watch a recording before using it. */
  playerLabels: NativePreviewLabels;
  /** Called exactly once per session with the outcome. Must be stable. */
  onResult: (result: PickResult) => void;
  reportError: DocumentKitErrorReporter;
  /** Must be stable. */
  reportTiming: CameraTimingReporter;
}

type Capture =
  | {kind: 'photo'; key: string; photo: NativeCapturedPhoto}
  | {kind: 'video'; key: string; video: NativeCapturedVideo};

const toPickedFile = (capture: Capture) =>
  capture.kind === 'photo'
    ? buildCapturedFile(capture.photo, 'camera_photo')
    : buildCapturedFile(capture.video, 'camera_video');

const toTrayItem = (capture: Capture, edits?: NativePhotoEdits): TrayItem =>
  capture.kind === 'photo'
    ? {key: capture.key, thumbnailUri: capture.photo.previewUri, photo: capture.photo, edits}
    : {
        key: capture.key,
        thumbnailUri: capture.video.posterUri,
        videoUri: capture.video.uri,
        durationSeconds: (capture.video.durationMs ?? 0) / 1000,
      };

/** Photo: off → auto → on. Video (torch): off ↔ on. */
const nextFlash = (current: FlashMode, mode: CameraMode): FlashMode => {
  if (mode === 'video') {
    return current === 'on' ? 'off' : 'on';
  }
  return current === 'off' ? 'auto' : current === 'auto' ? 'on' : 'off';
};

type CameraCaptureContentProps = Omit<CameraCaptureModalProps, 'session'> & {
  session: CameraSession;
};

let nextCaptureNumber = 1;

/**
 * Lives inside the Modal, so it unmounts when the modal closes and every
 * session starts from a clean state (back camera, flash off, nothing captured).
 */
const CameraCaptureContent: React.FC<CameraCaptureContentProps> = ({
  session,
  theme,
  labels,
  playerLabels,
  onResult,
  reportError,
  reportTiming,
}) => {
  const [mode, setMode] = useState<CameraMode>(session.initialMode);
  const [position, setPosition] = useState<CameraPosition>(session.initialPosition);
  const [flash, setFlash] = useState<FlashMode>('off');
  // Kept here, not in the viewfinder, so Retake keeps the user's choice.
  const [isSoundOn, setIsSoundOn] = useState(true);
  // Measured by the camera view; the review screens have no native view of their own to ask.
  const [insets, setInsets] = useState(FALLBACK_INSETS);
  // One capture under review (maxFiles 1)…
  const [capture, setCapture] = useState<Capture | null>(null);
  // …or several kept while the camera stays open (multi-capture).
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [isTrayOpen, setIsTrayOpen] = useState(false);
  // Multi-capture: each photo's Crop & Rotate edits, applied when the captures are used.
  const [editsByKey, setEditsByKey] = useState<Record<string, NativePhotoEdits>>({});
  const [hasEditFailed, setHasEditFailed] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);

  const isMultiCapture = session.maxFiles > 1;

  const markTiming = useCallback(
    (mark: CameraTimingMark) =>
      reportTiming({mark, elapsedMs: Date.now() - session.openedAt}),
    [reportTiming, session],
  );

  useEffect(() => {
    markTiming('screen_shown');
  }, [markTiming]);

  const togglePosition = () => {
    if (session.positions.length < 2) {
      return;
    }
    markTiming('switch_camera');
    setPosition(current => (current === 'back' ? 'front' : 'back'));
  };

  const changeMode = (next: CameraMode) => {
    setMode(next);
    // Auto is photo only.
    setFlash(current => (next === 'video' && current === 'auto' ? 'off' : current));
  };

  const handleClose = useCallback(
    () => onResult({status: 'cancelled'}),
    [onResult],
  );

  const handleNoDevice = useCallback(
    () => onResult({status: 'unavailable', reason: 'no_camera_device'}),
    [onResult],
  );

  const handleCaptureError = (error: unknown) => {
    reportError(error, {
      operation: mode === 'video' ? 'video_recording' : 'camera_capture',
    });
    onResult({status: 'error', code: 'capture_failed'});
  };

  const confirm = (list: Capture[]) => {
    if (list.length === 0 || isConfirming) {
      return;
    }
    setIsConfirming(true);
    markTiming('confirm');
    const files = list.map(toPickedFile);
    markTiming('result_ready');
    onResult({status: 'picked', files});
  };

  /** Multi-capture: writes each edited photo's copy, then hands everything over. */
  const confirmCaptures = async (list: Capture[]) => {
    if (list.length === 0 || isConfirming) {
      return;
    }
    const pending = list.filter(item => item.kind === 'photo' && editsByKey[item.key] && !isUnedited(editsByKey[item.key]));
    if (pending.length === 0) {
      confirm(list);
      return;
    }
    setIsConfirming(true);
    setHasEditFailed(false);
    try {
      const edited: Capture[] = [];
      // One at a time: each edit decodes a full photo.
      for (const item of list) {
        const edits = editsByKey[item.key];
        edited.push(
          item.kind === 'photo' && edits && !isUnedited(edits)
            ? {...item, photo: await editNativePhoto(item.photo.uri, edits)}
            : item,
        );
      }
      markTiming('confirm');
      const files = edited.map(toPickedFile);
      markTiming('result_ready');
      onResult({status: 'picked', files});
    } catch (error) {
      reportError(error, {operation: 'photo_edit'});
      setHasEditFailed(true);
      setIsConfirming(false);
    }
  };

  /** Single capture goes to review; multi-capture keeps it and returns true to keep shooting. */
  const keepCapture = (item: Capture): boolean => {
    if (!isMultiCapture) {
      if (session.review.enabled) {
        setCapture(item);
      } else {
        // No review: used as soon as it is saved.
        confirm([item]);
      }
      return false;
    }
    const next = [...captures, item];
    setCaptures(next);
    if (next.length >= session.maxFiles) {
      if (session.review.enabled) {
        setIsTrayOpen(true);
      } else {
        void confirmCaptures(next);
      }
      return false;
    }
    return true;
  };

  const removeCapture = (key: string) => {
    const next = captures.filter(item => item.key !== key);
    setCaptures(next);
    setEditsByKey(current => Object.fromEntries(Object.entries(current).filter(([itemKey]) => itemKey !== key)));
    if (next.length === 0) {
      setIsTrayOpen(false);
    }
  };

  const moveCapture = (key: string, toIndex: number) => {
    setCaptures(current => {
      const fromIndex = current.findIndex(item => item.key === key);
      if (fromIndex < 0 || fromIndex === toIndex) {
        return current;
      }
      const next = [...current];
      next.splice(toIndex, 0, ...next.splice(fromIndex, 1));
      return next;
    });
  };

  const retake = () => setCapture(null);
  const reportPlaybackError = (error: unknown) =>
    reportError(error, {operation: 'video_recording'});
  const reportEditError = (error: unknown) => reportError(error, {operation: 'photo_edit'});

  if (isTrayOpen) {
    return (
      <ReviewTray
        items={captures.map(item => toTrayItem(item, editsByKey[item.key]))}
        canAddMore={captures.length < session.maxFiles}
        isConfirming={isConfirming}
        hasEditFailed={hasEditFailed}
        review={session.review}
        theme={theme}
        labels={labels}
        playerLabels={playerLabels}
        insets={insets}
        closeLabel={labels.backToCamera}
        onClose={() => setIsTrayOpen(false)}
        onRemove={removeCapture}
        onReorder={moveCapture}
        onEdit={(key, edits) => {
          setEditsByKey(current => ({...current, [key]: edits}));
          setHasEditFailed(false);
        }}
        onAddMore={() => setIsTrayOpen(false)}
        onDone={() => void confirmCaptures(captures)}
        onPlaybackError={reportPlaybackError}
      />
    );
  }

  if (capture?.kind === 'photo') {
    return (
      <PhotoReview
        photo={capture.photo}
        review={session.review}
        labels={labels}
        theme={theme}
        insets={insets}
        isConfirming={isConfirming}
        onClose={handleClose}
        onRetake={retake}
        // A rotated or cropped photo comes back as an edited copy.
        onConfirm={photo => confirm([{...capture, photo}])}
        onEditError={reportEditError}
      />
    );
  }

  if (capture?.kind === 'video') {
    return (
      <VideoReview
        videoUri={capture.video.uri}
        fileName={capture.video.name}
        durationSeconds={(capture.video.durationMs ?? 0) / 1000}
        posterUri={capture.video.posterUri}
        sizeBytes={capture.video.size}
        labels={labels}
        playerLabels={playerLabels}
        hasHeader={session.review.header}
        insets={insets}
        isConfirming={isConfirming}
        theme={theme}
        onClose={handleClose}
        onRetake={retake}
        onConfirm={() => confirm([capture])}
        onPlaybackError={reportPlaybackError}
      />
    );
  }

  const last = captures[captures.length - 1];
  return (
    <CameraViewfinder
      session={session}
      mode={mode}
      position={position}
      flash={flash}
      isSoundOn={isSoundOn}
      captureCount={captures.length}
      lastThumbnailUri={last ? toTrayItem(last).thumbnailUri : null}
      theme={theme}
      labels={labels}
      onChangeMode={changeMode}
      onTogglePosition={togglePosition}
      onCycleFlash={() => setFlash(current => nextFlash(current, mode))}
      onToggleSound={() => setIsSoundOn(current => !current)}
      onPhotoTaken={photo =>
        keepCapture({kind: 'photo', key: `capture-${nextCaptureNumber++}`, photo})
      }
      onVideoRecorded={video => {
        keepCapture({kind: 'video', key: `capture-${nextCaptureNumber++}`, video});
      }}
      // Without the review, the thumbnail only counts the captures.
      onOpenTray={() => setIsTrayOpen(session.review.enabled)}
      onDone={() => void confirmCaptures(captures)}
      onClose={handleClose}
      onNoDevice={handleNoDevice}
      onCameraUnusable={error => {
        reportError(error, {operation: 'camera_capture'});
        handleNoDevice();
      }}
      onCameraError={handleCaptureError}
      onTiming={markTiming}
      onSafeAreaInsets={setInsets}
    />
  );
};

const dismissKeyboardOnIOS = () => {
  if (Platform.OS === 'ios') {
    requestAnimationFrame(() => Keyboard.dismiss());
  }
};

/**
 * Quick fade instead of the Modal's slide, which is slower than a camera
 * should open. Mounted per session, so every open fades in again.
 */
const FadeIn: React.FC<{children: React.ReactNode}> = ({children}) => {
  const [opacity] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.timing(opacity, {
      toValue: 1,
      duration: OPEN_FADE_MS,
      useNativeDriver: true,
    }).start();
  }, [opacity]);
  return (
    <Animated.View style={[StyleSheet.absoluteFill, {opacity}]}>
      {children}
    </Animated.View>
  );
};

/** Full-screen in-app camera: viewfinder (photo or video) → review → result. */
export const CameraCaptureModal: React.FC<CameraCaptureModalProps> = ({
  session,
  onResult,
  ...contentProps
}) => (
  <Modal
    visible={session !== null}
    transparent={true}
    animationType="none"
    presentationStyle="overFullScreen"
    onDismiss={dismissKeyboardOnIOS}
    onRequestClose={() => onResult({status: 'cancelled'})}
    {...(IS_ANDROID_16 && {
      statusBarTranslucent: true,
      navigationBarTranslucent: true,
    })}>
    {session ? (
      <FadeIn>
        <CameraCaptureContent session={session} onResult={onResult} {...contentProps} />
      </FadeIn>
    ) : null}
  </Modal>
);
