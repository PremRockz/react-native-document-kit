import {useMemo} from 'react';
import {Platform, StyleSheet} from 'react-native';
import type {DocumentKitCameraTheme} from './types';

export const cameraStyles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loaderWrap: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sideSlot: {
    width: 56,
    alignItems: 'center',
  },
  iconButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  shutterOuter: {
    width: 74,
    height: 74,
    borderRadius: 37,
    borderWidth: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  shutterInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
  },
  flashOnDot: {
    position: 'absolute',
    bottom: 6,
    alignSelf: 'center',
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  reviewBottomBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 12,
  },
  // Over a full-screen picture (video poster, capture list) instead of below it.
  reviewBottomBarFloating: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  reviewButton: {
    flex: 1,
    height: 52,
    borderRadius: 10,
    borderWidth: 1.5,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // The main action is the wider one.
  confirmButton: {
    flex: 1.4,
  },
  retakeButton: {
    backgroundColor: 'transparent',
  },
  buttonDimmed: {
    opacity: 0.6,
  },
  reviewButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});

export const recordingStyles = StyleSheet.create({
  recordDot: {
    width: 58,
    height: 58,
    borderRadius: 29,
  },
  stopSquare: {
    width: 28,
    height: 28,
    borderRadius: 6,
  },
  timerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 14,
    gap: 6,
  },
  timerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  timerText: {
    fontSize: 15,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  modeSwitch: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: 18,
  },
  modeOption: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 15,
  },
  modeText: {
    fontSize: 14,
    fontWeight: '600',
  },
  notice: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    fontSize: 13,
  },
  videoPoster: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  playButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  duration: {
    fontSize: 16,
    fontVariant: ['tabular-nums'],
  },
});

export const formatDuration = (totalSeconds: number): string => {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};

/** "18 MB", "740 KB": shown under a recording so the user sees what will upload. */
export const formatFileSize = (bytes: number): string => {
  if (bytes >= 1024 * 1024) {
    const megabytes = bytes / (1024 * 1024);
    return `${megabytes >= 10 ? Math.round(megabytes) : megabytes.toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
};

/** Safe-area insets used until the camera view reports the real ones. */
export const FALLBACK_INSETS = Platform.select({
  ios: {top: 48, right: 0, bottom: 24, left: 0},
  default: {top: 16, right: 0, bottom: 8, left: 0},
});

/** The camera screen (CameraViewfinder, ReviewTray). */
export const viewfinderStyles = StyleSheet.create({
  topBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  bottomBar: {
    position: 'absolute',
    left: 24,
    right: 24,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  // Equal widths on both sides keep the timer / Done centred.
  topSide: {
    width: 92,
    flexDirection: 'row',
    gap: 4,
  },
  topSideEnd: {
    justifyContent: 'flex-end',
  },
  centered: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  // Over the (black) paused preview, in the middle.
  interruption: {
    top: '45%',
    paddingHorizontal: 32,
  },
  flashAutoBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    fontSize: 10,
    fontWeight: '700',
  },
  donePill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 16,
  },
  donePillText: {
    fontSize: 14,
    fontWeight: '600',
  },
  shutterLayer: {
    position: 'absolute',
  },
  lensPills: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: 18,
    gap: 4,
  },
  lensPill: {
    minWidth: 34,
    height: 30,
    borderRadius: 15,
    paddingHorizontal: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  lensText: {
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  lensTextActive: {
    fontSize: 13,
  },
  thumbnail: {
    width: 44,
    height: 44,
    borderRadius: 8,
    borderWidth: 2,
    overflow: 'hidden',
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
  },
  countBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  countBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
});

/** The photo and video review screens. */
export const reviewStyles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingBottom: 8,
    gap: 4,
  },
  headerTitles: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  headerSubtitle: {
    marginTop: 2,
    fontSize: 13,
    opacity: 0.7,
    fontVariant: ['tabular-nums'],
  },
  imageArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  toolText: {
    fontSize: 16,
  },
  message: {
    textAlign: 'center',
    fontSize: 14,
    paddingHorizontal: 24,
    paddingTop: 8,
  },
  // The review screen's "Crop & Rotate" button.
  editButton: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 16,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 26,
    borderWidth: 1.5,
  },
});

/** Multi-capture review. */
export const TRAY_THUMBNAIL_SIZE = 68;
export const TRAY_THUMBNAIL_BORDER = 2;

export const trayStyles = StyleSheet.create({
  page: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 12,
  },
  roundButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  titles: {
    flex: 1,
  },
  // Over the photo with no bar behind it, so the text carries its own shadow.
  title: {
    fontSize: 17,
    fontWeight: '600',
    textShadowColor: 'rgba(0, 0, 0, 0.6)',
    textShadowRadius: 4,
  },
  counter: {
    marginTop: 2,
    fontSize: 13,
    opacity: 0.85,
    fontVariant: ['tabular-nums'],
    textShadowColor: 'rgba(0, 0, 0, 0.6)',
    textShadowRadius: 4,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 10,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    opacity: 0.35,
  },
  thumbnails: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16,
    gap: 12,
    alignItems: 'center',
  },
  thumbnailSlot: {
    paddingTop: 6,
    paddingRight: 6,
  },
  thumbnail: {
    width: TRAY_THUMBNAIL_SIZE,
    height: TRAY_THUMBNAIL_SIZE,
    borderRadius: 12,
    borderWidth: TRAY_THUMBNAIL_BORDER,
    overflow: 'hidden',
  },
  thumbnailEdited: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
  },
  thumbnailIdle: {
    borderColor: 'transparent',
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
  },
  thumbnailPlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
  },
  removeBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addTile: {
    width: 68,
    height: 68,
    borderRadius: 12,
    marginTop: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  message: {
    textAlign: 'center',
    fontSize: 14,
    paddingHorizontal: 24,
    paddingBottom: 8,
  },
  attach: {
    marginHorizontal: 16,
    height: 54,
    borderRadius: 27,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
  },
  attachLabel: {
    fontSize: 17,
    fontWeight: '600',
  },
});

/** The photo editor (Crop & Rotate). */
export const editorStyles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  textButton: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  textButtonLabel: {
    fontSize: 17,
  },
  doneButton: {
    paddingVertical: 8,
    paddingHorizontal: 18,
    borderRadius: 8,
  },
  doneLabel: {
    fontSize: 17,
    fontWeight: '600',
  },
  imageArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  // Same height on every tab, so the photo does not jump when switching.
  panel: {
    height: 120,
    justifyContent: 'center',
  },
  presets: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 12,
  },
  preset: {
    alignItems: 'center',
    gap: 8,
    minWidth: 52,
    paddingVertical: 6,
  },
  presetShapeBox: {
    width: 28,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  presetShape: {
    borderWidth: 2,
    borderRadius: 3,
  },
  presetLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  rotateButtons: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
  },
  rotateButton: {
    flex: 1,
    height: 72,
    borderWidth: 1.5,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  rotateLabel: {
    fontSize: 15,
    fontWeight: '500',
  },
  tabs: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    paddingTop: 12,
  },
  tabIndicator: {
    position: 'absolute',
    top: -1,
    width: 56,
    height: 3,
    borderRadius: 1.5,
  },
  tabLabel: {
    fontSize: 14,
  },
});

/** The straighten ruler. */
export const rulerStyles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: 8,
  },
  value: {
    fontSize: 16,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  track: {
    alignSelf: 'stretch',
    height: 36,
    marginHorizontal: 24,
  },
  tick: {
    position: 'absolute',
    width: 1,
    bottom: 4,
  },
  tickMinor: {
    height: 12,
    opacity: 0.5,
  },
  tickMajor: {
    height: 20,
    opacity: 0.9,
  },
  needle: {
    position: 'absolute',
    width: 2,
    height: 30,
    bottom: 2,
    borderRadius: 1,
  },
});

/** The crop frame over the photo. */
export const cropStyles = StyleSheet.create({
  shade: {
    position: 'absolute',
  },
  frame: {
    position: 'absolute',
    borderWidth: 1.5,
  },
  gridLine: {
    position: 'absolute',
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
  },
  // Round corner handles: white, ringed in primaryColor.
  handle: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    backgroundColor: '#FFFFFF',
  },
});

/** CaptureProgress: the saving bar and pill. */
export const captureProgressStyles = StyleSheet.create({
  barTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 3,
    overflow: 'hidden',
  },
  stripe: {
    height: 3,
    borderRadius: 1.5,
  },
  pillRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 22,
  },
  pillText: {
    fontSize: 15,
    fontWeight: '500',
  },
});

/** The theme's colours and font, laid over the layout sheets above. */
export const useThemeStyles = (theme: DocumentKitCameraTheme) =>
  useMemo(
    () =>
      StyleSheet.create({
        screen: {backgroundColor: theme.backgroundColor},
        text: {color: theme.textColor, fontFamily: theme.fontFamily},
        primaryText: {color: theme.primaryColor, fontFamily: theme.fontFamily},
        onPrimaryText: {color: theme.onPrimaryColor, fontFamily: theme.fontFamily},
        primaryFill: {backgroundColor: theme.primaryColor},
        primaryBorder: {borderColor: theme.primaryColor},
        overlay: {backgroundColor: theme.overlayColor},
        shutterRing: {borderColor: theme.shutterColor},
        shutterFill: {backgroundColor: theme.shutterColor},
        recordFill: {backgroundColor: theme.recordColor},
        // The flash "on" dot and "A" badge belong to the flash icon.
        iconFill: {backgroundColor: theme.iconColor},
        iconText: {color: theme.iconColor, fontFamily: theme.fontFamily},
        iconBorder: {borderColor: theme.iconColor},
        activeZoomText: {color: theme.activeZoomColor},
        surface: {backgroundColor: theme.surfaceColor},
        playButton: {backgroundColor: theme.playButtonColor},
        posterScrim: {backgroundColor: theme.posterScrimColor},
        outlineBorder: {borderColor: theme.outlineColor},
        toast: {backgroundColor: theme.toastColor},
      }),
    [theme],
  );
