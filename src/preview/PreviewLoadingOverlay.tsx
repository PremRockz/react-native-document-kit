import React, {useMemo} from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

export interface PreviewLoadingLabels {
  preparingPreview: string;
  cancel: string;
}

export interface PreviewLoadingTheme {
  /** Buttons, spinner and progress fill. */
  primaryColor: string;
  /** Dims the app behind the card. */
  previewBackdropColor: string;
  previewCardColor: string;
  /** "Opening file…". */
  previewTitleColor: string;
  /** The file name. */
  previewTextColor: string;
  /** Unfilled part of the progress bar. */
  previewTrackColor: string;
  fontFamily?: string;
}

interface PreviewLoadingOverlayProps {
  visible: boolean;
  fileName: string;
  /** 0–1, or null while the size is unknown. */
  fraction: number | null;
  theme: PreviewLoadingTheme;
  labels: PreviewLoadingLabels;
  onCancel: () => void;
  /** iOS only: fires once the overlay has finished closing. */
  onDismiss: () => void;
}

/** Shown only while a document downloads before its viewer opens. */
export const PreviewLoadingOverlay: React.FC<PreviewLoadingOverlayProps> = ({
  visible,
  fileName,
  fraction,
  theme,
  labels,
  onCancel,
  onDismiss,
}) => {
  const themed = useMemo(
    () =>
      StyleSheet.create({
        backdrop: {backgroundColor: theme.previewBackdropColor},
        card: {backgroundColor: theme.previewCardColor},
        title: {color: theme.previewTitleColor, fontFamily: theme.fontFamily},
        fileName: {color: theme.previewTextColor, fontFamily: theme.fontFamily},
        track: {backgroundColor: theme.previewTrackColor},
        fill: {backgroundColor: theme.primaryColor},
        cancelText: {color: theme.primaryColor, fontFamily: theme.fontFamily},
      }),
    [theme],
  );
  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onCancel}
      onDismiss={onDismiss}>
      <View style={[styles.backdrop, themed.backdrop]}>
        <View style={[styles.card, themed.card]}>
          <Text style={[styles.title, themed.title]}>{labels.preparingPreview}</Text>
          <Text style={[styles.fileName, themed.fileName]} numberOfLines={1} ellipsizeMode="middle">
            {fileName}
          </Text>
          {fraction === null ? (
            <ActivityIndicator color={theme.primaryColor} style={styles.progress} />
          ) : (
            <View
              style={[styles.progress, styles.track, themed.track]}
              accessibilityRole="progressbar"
              accessibilityValue={{min: 0, max: 100, now: Math.round(fraction * 100)}}>
              <View
                style={[styles.fill, themed.fill, {width: `${Math.round(fraction * 100)}%`}]}
              />
            </View>
          )}
          <Pressable
            onPress={onCancel}
            hitSlop={8}
            accessibilityRole="button"
            style={styles.cancel}>
            <Text style={[styles.cancelText, themed.cancelText]}>
              {labels.cancel}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  card: {
    borderRadius: 12,
    padding: 20,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
  },
  fileName: {
    marginTop: 4,
    fontSize: 14,
  },
  progress: {
    marginTop: 16,
  },
  track: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 3,
  },
  cancel: {
    marginTop: 16,
    alignSelf: 'flex-end',
  },
  cancelText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
