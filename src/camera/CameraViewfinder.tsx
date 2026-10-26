import React, {useEffect, useState} from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import DocumentKitCameraView from '../specs/DocumentKitCameraViewNativeComponent';
import type {
  CameraInterruptionEvent,
  CameraSafeAreaEvent,
  CameraZoomEvent,
} from '../specs/DocumentKitCameraViewNativeComponent';
import type {
  NativeCapturedPhoto,
  NativeCapturedVideo,
} from '../specs/NativeDocumentKitCamera';
import {CaptureProgress} from './CaptureProgress';
import {CloseIcon, FlashIcon, MicIcon, PauseIcon, PlayIcon, SwitchCameraIcon} from './icons';
import {
  isRecordingCancelled,
  nativeCameraControls,
  startNativeRecording,
  takeNativePhoto,
} from './nativeCamera';
import {
  FALLBACK_INSETS,
  cameraStyles,
  formatDuration,
  recordingStyles,
  useThemeStyles,
  viewfinderStyles,
} from './styles';
import {VIDEO_SETTINGS} from './types';
import type {
  CameraMode,
  CameraPosition,
  CameraSession,
  CameraTimingMark,
  DocumentKitCameraLabels,
  DocumentKitCameraTheme,
  FlashMode,
} from './types';

interface CameraViewfinderProps {
  session: CameraSession;
  mode: CameraMode;
  position: CameraPosition;
  flash: FlashMode;
  /** Video: the user's microphone switch (only shown when the session may record sound). */
  isSoundOn: boolean;
  /** Multi-capture: how many are taken so far and the last one's thumbnail. */
  captureCount: number;
  lastThumbnailUri: string | null;
  theme: DocumentKitCameraTheme;
  labels: DocumentKitCameraLabels;
  onChangeMode: (mode: CameraMode) => void;
  onTogglePosition: () => void;
  onCycleFlash: () => void;
  onToggleSound: () => void;
  /** Return true to keep shooting (multi-capture): the preview unfreezes. */
  onPhotoTaken: (photo: NativeCapturedPhoto) => boolean;
  onVideoRecorded: (video: NativeCapturedVideo) => void;
  onOpenTray: () => void;
  onDone: () => void;
  onClose: () => void;
  onNoDevice: () => void;
  /** The camera failed before showing a picture; the caller can fall back to the OS camera. */
  onCameraUnusable: (error: unknown) => void;
  onCameraError: (error: unknown) => void;
  onTiming: (mark: CameraTimingMark) => void;
  /** The safe area the camera view measured, for the review screens that follow. */
  onSafeAreaInsets: (insets: CameraSafeAreaEvent) => void;
}

const SHUTTER_SIZE = 74;
const ROW_HEIGHT = 44;
const MORPH_MS = 180;
const ROTATE_MS = 220;

let nextCameraNumber = 1;

/** What to tell the user while the system has paused the camera. */
const interruptionMessage = (reason: string, labels: DocumentKitCameraLabels): string => {
  if (reason === 'multitasking') {
    return labels.cameraPausedMultitasking;
  }
  return reason === 'in_use' ? labels.cameraInUse : labels.cameraPaused;
};

/** ".5", "1", "1.4", "2": zoom as the lens pills show it. */
const formatZoom = (zoom: number): string =>
  zoom < 1 ? `.${Math.round(zoom * 10)}` : `${Math.round(zoom * 10) / 10}`;

/** The lens stops this camera offers: ultra-wide (below 1×), 1×, and 2× when it zooms that far. */
const toLensStops = (zoom: CameraZoomEvent): number[] => [
  ...(zoom.minZoom < 0.95 ? [zoom.minZoom] : []),
  1,
  ...(zoom.maxZoom >= 2 ? [2] : []),
];

/**
 * Icons turn upright when the phone is turned and the screen does not turn with it
 * (native reports the turn relative to the screen, so a rotating iPad reports 0).
 * Shortest way round: a phone turned 90° clockwise turns its icons back 90°.
 */
const toIconRotation = (degrees: number): number =>
  degrees === 90 ? -90 : degrees === 270 ? 90 : degrees === 180 ? 180 : 0;

const useReduceMotion = (): boolean => {
  const [isReduceMotion, setIsReduceMotion] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setIsReduceMotion, () => undefined);
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setIsReduceMotion,
    );
    return () => subscription.remove();
  }, []);
  return isReduceMotion;
};

/**
 * DocumentKit's own camera screen (plan §4.1): live preview with pinch zoom and
 * tap to focus, lens pills, Photo / Video switch (tap or swipe), flash
 * (off / auto / on; torch for video), recording with pause and limit, icons
 * that turn with the phone, and the multi-capture thumbnail and Done button.
 */
export const CameraViewfinder: React.FC<CameraViewfinderProps> = ({
  session,
  mode,
  position,
  flash,
  isSoundOn,
  captureCount,
  lastThumbnailUri,
  theme,
  labels,
  onChangeMode,
  onTogglePosition,
  onCycleFlash,
  onToggleSound,
  onPhotoTaken,
  onVideoRecorded,
  onOpenTray,
  onDone,
  onClose,
  onNoDevice,
  onCameraUnusable,
  onCameraError,
  onTiming,
  onSafeAreaInsets,
}) => {
  const [cameraId] = useState(() => `document-kit-camera-${nextCameraNumber++}`);
  const [controls] = useState(() => nativeCameraControls(cameraId));
  const [isPreviewStarted, setIsPreviewStarted] = useState(false);
  const [hasFlash, setHasFlash] = useState(false);
  const [zoom, setZoom] = useState<CameraZoomEvent | null>(null);
  const [insets, setInsets] = useState<CameraSafeAreaEvent>(FALLBACK_INSETS);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  // Stop pressed; the recording is still being finished into a file.
  const [isFinishingVideo, setIsFinishingVideo] = useState(false);
  // The system paused the camera (Split View, a call, another app); it resumes on its own.
  const [interruption, setInterruption] = useState<CameraInterruptionEvent | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const isReduceMotion = useReduceMotion();
  const themed = useThemeStyles(theme);
  // A missing camera moves to the other allowed one once; if that is missing too, there is none.
  const [hasTriedOtherPosition, setHasTriedOtherPosition] = useState(false);
  const [iconRotation] = useState(() => new Animated.Value(0));
  const [recordingMorph] = useState(() => new Animated.Value(0));

  const isVideoMode = mode === 'video';
  const isBusy = isCapturing || isRecording;
  const canUseFlash = hasFlash && session.isFlashEnabled;
  const otherPosition: CameraPosition = position === 'back' ? 'front' : 'back';
  const canSwitchPosition = session.positions.includes(otherPosition);
  const isSaving = isCapturing || isFinishingVideo;
  const canCapture = isPreviewStarted && !isSaving && !interruption;
  const videoSettings = VIDEO_SETTINGS[session.videoQuality];

  useEffect(() => {
    Animated.timing(recordingMorph, {
      toValue: isRecording ? 1 : 0,
      duration: isReduceMotion ? 0 : MORPH_MS,
      useNativeDriver: true,
    }).start();
  }, [isRecording, isReduceMotion, recordingMorph]);

  const changeMode = (direction: 1 | -1) => {
    const next = session.modes[session.modes.indexOf(mode) + direction];
    if (next && !isBusy) {
      onChangeMode(next);
    }
  };

  const takePhoto = async () => {
    if (!canCapture) {
      return;
    }
    setIsCapturing(true);
    onTiming('shutter');
    try {
      const photo = await takeNativePhoto(cameraId, canUseFlash ? flash : 'off');
      onTiming('capture_done');
      if (onPhotoTaken(photo)) {
        controls.resumePreview();
      }
    } catch (error) {
      onCameraError(error);
    } finally {
      setIsCapturing(false);
    }
  };

  const startRecording = () => {
    if (!canCapture) {
      return;
    }
    setElapsedSeconds(0);
    setIsPaused(false);
    setIsRecording(true);
    startNativeRecording(cameraId, {
      isAudioEnabled: session.isAudioEnabled && isSoundOn,
      maxDurationSeconds: session.maxDurationSeconds,
    }).then(
      video => {
        onTiming('capture_done');
        setIsRecording(false);
        setIsFinishingVideo(false);
        onVideoRecorded(video);
      },
      error => {
        setIsRecording(false);
        setIsFinishingVideo(false);
        if (!isRecordingCancelled(error)) {
          onCameraError(error);
        }
      },
    );
  };

  const handleShutter = () => {
    if (!isVideoMode) {
      takePhoto();
    } else if (isRecording) {
      onTiming('shutter');
      setIsFinishingVideo(true);
      controls.stopRecording();
    } else {
      startRecording();
    }
  };

  const togglePause = () => {
    if (isPaused) {
      controls.resumeRecording();
    } else {
      controls.pauseRecording();
    }
    setIsPaused(!isPaused);
  };

  const handleClose = () => {
    if (isRecording) {
      // Discarded; its promise rejects E_CANCELLED, which is ignored above.
      controls.cancelRecording();
    }
    onClose();
  };

  const rotate = {
    transform: [
      {
        rotate: iconRotation.interpolate({
          inputRange: [-180, 180],
          outputRange: ['-180deg', '180deg'],
        }),
      },
    ],
  };

  const topOffset = insets.top + 8;
  const bottomBarOffset = insets.bottom + 24;
  const modeSwitchOffset = bottomBarOffset + SHUTTER_SIZE + 16;
  const hasModeSwitch = session.modes.length > 1 && !isRecording;
  const lensStops = zoom ? toLensStops(zoom) : [];
  const hasLensPills = session.isZoomEnabled && lensStops.length > 1 && !isSaving;
  const lensOffset = modeSwitchOffset + (hasModeSwitch ? ROW_HEIGHT : 0);
  const noticeOffset = lensOffset + (hasLensPills ? ROW_HEIGHT : 0);
  const activeStop = zoom
    ? [...lensStops].reverse().find(stop => zoom.zoom >= stop - 0.01) ?? lensStops[0]
    : 1;

  const hasSoundSwitch = isVideoMode && session.isAudioEnabled;
  const isRecordingSilent = !session.isAudioEnabled || !isSoundOn;

  const flashState =
    flash === 'on' ? labels.flashOn : flash === 'auto' ? labels.flashAuto : labels.flashOff;

  const renderShutter = () => {
    if (!isVideoMode) {
      // Dimmed while the photo saves; CaptureProgress tells what is happening.
      return (
        <View
          style={[cameraStyles.shutterInner, themed.shutterFill, isCapturing && cameraStyles.buttonDimmed]}
        />
      );
    }
    return (
      <>
        <Animated.View
          style={[
            viewfinderStyles.shutterLayer,
            recordingStyles.recordDot,
            themed.recordFill,
            {
              opacity: recordingMorph.interpolate({inputRange: [0, 1], outputRange: [1, 0]}),
              transform: [
                {scale: recordingMorph.interpolate({inputRange: [0, 1], outputRange: [1, 0.45]})},
              ],
            },
          ]}
        />
        <Animated.View
          style={[
            viewfinderStyles.shutterLayer,
            recordingStyles.stopSquare,
            themed.recordFill,
            {
              opacity: recordingMorph,
              transform: [
                {scale: recordingMorph.interpolate({inputRange: [0, 1], outputRange: [0.6, 1]})},
              ],
            },
          ]}
        />
      </>
    );
  };

  return (
    <View style={[cameraStyles.container, themed.screen]}>
      <DocumentKitCameraView
        style={StyleSheet.absoluteFill}
        cameraId={cameraId}
        cameraPosition={position}
        mode={mode}
        videoQuality={session.videoQuality}
        videoBitRateKbps={videoSettings.bitRateKbps}
        torch={isVideoMode && canUseFlash && flash === 'on'}
        isZoomEnabled={session.isZoomEnabled}
        onPreviewStarted={({nativeEvent}) => {
          setIsPreviewStarted(true);
          setHasFlash(nativeEvent.hasFlash);
          onTiming('preview_started');
        }}
        onCameraError={({nativeEvent}) => {
          const error = new Error(`${nativeEvent.code}: ${nativeEvent.message}`);
          if (nativeEvent.code === 'no_device' && canSwitchPosition && !hasTriedOtherPosition) {
            // No camera on this side (e.g. a tablet with only a front camera): use the other one.
            setHasTriedOtherPosition(true);
            onTogglePosition();
          } else if (nativeEvent.code === 'no_device') {
            onNoDevice();
          } else if (!isPreviewStarted) {
            // Never showed a picture: hand over to the OS camera rather than fail the pick.
            onCameraUnusable(error);
          } else {
            onCameraError(error);
          }
        }}
        onZoomChanged={({nativeEvent}) => setZoom(nativeEvent)}
        onRecordingProgress={({nativeEvent}) =>
          setElapsedSeconds(Math.floor(nativeEvent.seconds))
        }
        onOrientationChanged={({nativeEvent}) =>
          Animated.timing(iconRotation, {
            toValue: toIconRotation(nativeEvent.degrees),
            duration: isReduceMotion ? 0 : ROTATE_MS,
            useNativeDriver: true,
          }).start()
        }
        onSafeAreaInsets={({nativeEvent}) => {
          setInsets(nativeEvent);
          onSafeAreaInsets(nativeEvent);
        }}
        onSwipe={({nativeEvent}) => changeMode(nativeEvent.direction === 'left' ? 1 : -1)}
        onInterruption={({nativeEvent}) => setInterruption(nativeEvent.isInterrupted ? nativeEvent : null)}
      />

      {isPreviewStarted ? null : (
        <View style={cameraStyles.loaderWrap}>
          <ActivityIndicator size="large" color={theme.textColor} />
        </View>
      )}

      <View style={[viewfinderStyles.topBar, {top: topOffset}]}>
        <View style={viewfinderStyles.topSide}>
          <Pressable
            onPress={handleClose}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={labels.close}
            style={cameraStyles.iconButton}>
            <Animated.View style={rotate}>
              <CloseIcon color={theme.iconColor} />
            </Animated.View>
          </Pressable>
        </View>

        {isRecording ? (
          <View
            style={[recordingStyles.timerPill, themed.overlay]}
            accessibilityLiveRegion="polite">
            {isPaused ? null : <View style={[recordingStyles.timerDot, themed.recordFill]} />}
            <Text style={[recordingStyles.timerText, themed.text]}>
              {formatDuration(elapsedSeconds)}
              {session.maxDurationSeconds > 0
                ? ` / ${formatDuration(session.maxDurationSeconds)}`
                : ''}
            </Text>
          </View>
        ) : captureCount > 0 ? (
          <Pressable
            onPress={onDone}
            disabled={isCapturing}
            accessibilityRole="button"
            style={[viewfinderStyles.donePill, themed.primaryFill]}>
            <Text style={[viewfinderStyles.donePillText, themed.onPrimaryText]}>
              {`${labels.done} (${captureCount})`}
            </Text>
          </Pressable>
        ) : null}

        <View style={[viewfinderStyles.topSide, viewfinderStyles.topSideEnd]}>
          {hasSoundSwitch ? (
            <Pressable
              onPress={onToggleSound}
              // A recording keeps the sound setting it started with.
              disabled={isBusy}
              hitSlop={8}
              accessibilityRole="switch"
              accessibilityLabel={labels.recordSound}
              accessibilityState={{checked: isSoundOn, disabled: isBusy}}
              style={cameraStyles.iconButton}>
              <Animated.View style={rotate}>
                <MicIcon color={theme.iconColor} isOff={!isSoundOn} />
              </Animated.View>
            </Pressable>
          ) : null}
          {canUseFlash ? (
            <Pressable
              onPress={onCycleFlash}
              // The torch can change while recording; a photo's flash cannot change mid-shot.
              disabled={isCapturing}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={labels.toggleFlash}
              accessibilityValue={{text: flashState}}
              accessibilityState={{disabled: isCapturing}}
              style={cameraStyles.iconButton}>
              <Animated.View style={rotate}>
                <FlashIcon color={theme.iconColor} />
              </Animated.View>
              {flash === 'on' ? <View style={[cameraStyles.flashOnDot, themed.iconFill]} /> : null}
              {flash === 'auto' && !isVideoMode ? (
                <Text style={[viewfinderStyles.flashAutoBadge, themed.iconText]}>A</Text>
              ) : null}
            </Pressable>
          ) : null}
        </View>
      </View>

      {interruption ? (
        <View style={[viewfinderStyles.centered, viewfinderStyles.interruption]} accessibilityLiveRegion="polite">
          <Text style={[recordingStyles.notice, themed.overlay, themed.text]}>
            {interruptionMessage(interruption.reason, labels)}
          </Text>
        </View>
      ) : null}

      {isVideoMode && isRecordingSilent && !isSaving ? (
        <View style={[viewfinderStyles.centered, {bottom: noticeOffset}]}>
          <Text style={[recordingStyles.notice, themed.overlay, themed.text]}>
            {labels.recordingWithoutSound}
          </Text>
        </View>
      ) : null}

      {hasLensPills && zoom ? (
        <View style={[viewfinderStyles.centered, {bottom: lensOffset}]}>
          <View style={[viewfinderStyles.lensPills, themed.overlay]}>
            {lensStops.map(stop => {
              const isActive = stop === activeStop;
              return (
                <Pressable
                  key={stop}
                  onPress={() => controls.setZoom(stop)}
                  accessibilityRole="button"
                  accessibilityLabel={`${formatZoom(stop)}×`}
                  accessibilityState={{selected: isActive}}
                  style={[viewfinderStyles.lensPill, isActive && themed.overlay]}>
                  <Text
                    style={[
                      viewfinderStyles.lensText,
                      themed.text,
                      isActive && [viewfinderStyles.lensTextActive, themed.activeZoomText],
                    ]}>
                    {isActive ? `${formatZoom(zoom.zoom)}×` : formatZoom(stop)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      {hasModeSwitch ? (
        <View style={[viewfinderStyles.centered, {bottom: modeSwitchOffset}]}>
          <View style={[recordingStyles.modeSwitch, themed.overlay]} accessibilityRole="tablist">
            {session.modes.map(option => {
              const isSelected = option === mode;
              return (
                <Pressable
                  key={option}
                  onPress={() => onChangeMode(option)}
                  disabled={isCapturing}
                  accessibilityRole="tab"
                  accessibilityState={{selected: isSelected}}
                  style={[
                    recordingStyles.modeOption,
                    isSelected && themed.primaryFill,
                  ]}>
                  <Text
                    style={[
                      recordingStyles.modeText,
                      isSelected ? themed.onPrimaryText : themed.text,
                    ]}>
                    {option === 'photo' ? labels.photoMode : labels.videoMode}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      <View style={[viewfinderStyles.bottomBar, {bottom: bottomBarOffset}]}>
        <View style={cameraStyles.sideSlot}>
          {isRecording && !isFinishingVideo ? (
            <Pressable
              onPress={togglePause}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={isPaused ? labels.resumeRecording : labels.pauseRecording}
              style={cameraStyles.iconButton}>
              <Animated.View style={rotate}>
                {isPaused ? (
                  <PlayIcon color={theme.iconColor} size={24} />
                ) : (
                  <PauseIcon color={theme.iconColor} />
                )}
              </Animated.View>
            </Pressable>
          ) : lastThumbnailUri ? (
            <Pressable
              onPress={onOpenTray}
              disabled={isCapturing}
              accessibilityRole="button"
              accessibilityLabel={`${labels.reviewCaptures} (${captureCount})`}>
              <Animated.View style={[viewfinderStyles.thumbnail, themed.iconBorder, rotate]}>
                <Image source={{uri: lastThumbnailUri}} style={viewfinderStyles.thumbnailImage} />
              </Animated.View>
              <View style={[viewfinderStyles.countBadge, themed.primaryFill]}>
                <Text style={[viewfinderStyles.countBadgeText, themed.onPrimaryText]}>{captureCount}</Text>
              </View>
            </Pressable>
          ) : null}
        </View>

        <Pressable
          onPress={handleShutter}
          disabled={!canCapture}
          accessibilityRole="button"
          accessibilityLabel={
            isVideoMode
              ? isRecording
                ? labels.stopRecording
                : labels.startRecording
              : labels.takePhoto
          }
          accessibilityState={{disabled: !canCapture}}
          style={[cameraStyles.shutterOuter, themed.shutterRing]}>
          {renderShutter()}
        </Pressable>

        <View style={cameraStyles.sideSlot}>
          {isBusy || !canSwitchPosition ? null : (
            <Pressable
              onPress={onTogglePosition}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={labels.switchCamera}
              style={cameraStyles.iconButton}>
              <Animated.View style={rotate}>
                <SwitchCameraIcon color={theme.iconColor} />
              </Animated.View>
            </Pressable>
          )}
        </View>
      </View>

      <CaptureProgress
        isActive={isSaving}
        label={isCapturing ? labels.savingPhoto : labels.savingVideo}
        theme={theme}
        isReduceMotion={isReduceMotion}
        barTop={insets.top}
        pillBottom={modeSwitchOffset}
      />
    </View>
  );
};
