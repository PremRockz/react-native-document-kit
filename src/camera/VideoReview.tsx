import React from 'react';
import {Image, Pressable, StyleSheet, Text, View} from 'react-native';
import NativeDocumentKitPreview from '../specs/NativeDocumentKitPreview';
import type {NativePreviewLabels} from '../specs/NativeDocumentKitPreview';
import {toPlayerOptions} from '../preview/preview';
import {PlayIcon} from './icons';
import {ReviewActions, ReviewHeader} from './PhotoReview';
import {
  cameraStyles,
  formatDuration,
  formatFileSize,
  recordingStyles,
  reviewStyles,
  useThemeStyles,
} from './styles';
import type {DocumentKitCameraLabels, DocumentKitCameraTheme} from './types';

/**
 * Plays a recording in DocumentKit's native player. Never throws: a native
 * failure, even a synchronous one (e.g. an app binary older than the JS),
 * goes to onError instead of crashing the camera.
 */
export const playRecording = (
  videoUri: string,
  title: string,
  playerLabels: NativePreviewLabels,
  theme: DocumentKitCameraTheme,
  onError: (error: unknown) => void,
): void => {
  try {
    NativeDocumentKitPreview.playMedia(
      videoUri,
      {},
      title,
      playerLabels,
      toPlayerOptions({accentColor: theme.primaryColor, mimeType: 'video/mp4'}),
    ).catch(onError);
  } catch (error) {
    onError(error);
  }
};

interface VideoReviewProps {
  videoUri: string;
  /** "Video_1700000000000.mp4", shown in the header. */
  fileName: string;
  durationSeconds: number;
  /** First frame; without it the background stays black. */
  posterUri?: string;
  /** Shown next to the duration, so the user sees what is about to upload. */
  sizeBytes?: number;
  labels: DocumentKitCameraLabels;
  playerLabels: NativePreviewLabels;
  /** Close button, title and file details at the top. */
  hasHeader: boolean;
  insets: {top: number; bottom: number};
  isConfirming: boolean;
  theme: DocumentKitCameraTheme;
  onClose: () => void;
  onRetake: () => void;
  onConfirm: () => void;
  onPlaybackError: (error: unknown) => void;
}

/**
 * Shows the recording's first frame, length and size with a play button that
 * opens DocumentKit's native player, then Retake / Use Video before handing it back.
 */
export const VideoReview: React.FC<VideoReviewProps> = ({
  videoUri,
  fileName,
  durationSeconds,
  posterUri,
  sizeBytes,
  labels,
  playerLabels,
  hasHeader,
  insets,
  isConfirming,
  theme,
  onClose,
  onRetake,
  onConfirm,
  onPlaybackError,
}) => {
  const themed = useThemeStyles(theme);
  const play = () => playRecording(videoUri, labels.videoMode, playerLabels, theme, onPlaybackError);

  const details = [
    formatDuration(durationSeconds),
    ...(sizeBytes ? [formatFileSize(sizeBytes)] : []),
  ].join(' · ');

  return (
    <View style={[cameraStyles.container, themed.screen]}>
      {hasHeader ? (
        <ReviewHeader
          title={labels.reviewVideo}
          subtitle={[fileName, ...(sizeBytes ? [formatFileSize(sizeBytes)] : [])].join(' · ')}
          closeLabel={labels.close}
          theme={theme}
          topInset={insets.top}
          onClose={onClose}
        />
      ) : (
        <View style={{height: insets.top}} />
      )}
      <View style={reviewStyles.imageArea}>
        {posterUri ? (
          <>
            <Image source={{uri: posterUri}} style={StyleSheet.absoluteFill} resizeMode="contain" />
            <View style={[StyleSheet.absoluteFill, themed.posterScrim]} />
          </>
        ) : null}
        <View style={recordingStyles.videoPoster}>
          <Pressable
            onPress={play}
            disabled={isConfirming}
            accessibilityRole="button"
            accessibilityLabel={labels.playVideo}
            style={[recordingStyles.playButton, themed.playButton]}>
            <PlayIcon color={theme.iconColor} size={34} />
          </Pressable>
          <Text style={[recordingStyles.duration, themed.text]}>{details}</Text>
        </View>
      </View>
      <ReviewActions
        retakeLabel={labels.retake}
        confirmLabel={labels.useVideo}
        isConfirming={isConfirming}
        bottomInset={insets.bottom}
        theme={theme}
        onRetake={onRetake}
        onConfirm={onConfirm}
      />
    </View>
  );
};
