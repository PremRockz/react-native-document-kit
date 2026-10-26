import React, {useEffect, useState} from 'react';
import {ActivityIndicator, Image, Pressable, Text, View} from 'react-native';
import type {LayoutChangeEvent} from 'react-native';
import type {NativeCapturedPhoto, NativePhotoEdits} from '../specs/NativeDocumentKitCamera';
import {EditedPhoto} from './EditedPhoto';
import {CheckIcon, CloseIcon, CropIcon, PlusIcon, RetakeIcon} from './icons';
import {editNativePhoto} from './nativeCamera';
import {NO_EDITS, isUnedited} from './photoEdits';
import {PhotoEditor} from './PhotoEditor';
import {cameraStyles, formatFileSize, reviewStyles, useThemeStyles} from './styles';
import type {CameraReviewOptions, DocumentKitCameraLabels, DocumentKitCameraTheme} from './types';

interface ReviewHeaderProps {
  title: string;
  /** "IMG_1050.jpg · 2.1 MB". */
  subtitle: string;
  closeLabel: string;
  theme: DocumentKitCameraTheme;
  topInset: number;
  onClose: () => void;
}

/** Close, title and file details at the top of the review screens. */
export const ReviewHeader: React.FC<ReviewHeaderProps> = ({
  title,
  subtitle,
  closeLabel,
  theme,
  topInset,
  onClose,
}) => {
  const themed = useThemeStyles(theme);
  return (
    <View style={[reviewStyles.header, {paddingTop: topInset + 4}]}>
      <Pressable
        onPress={onClose}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={closeLabel}
        style={cameraStyles.iconButton}>
        <CloseIcon color={theme.iconColor} />
      </Pressable>
      <View style={reviewStyles.headerTitles}>
        <Text style={[reviewStyles.headerTitle, themed.text]} accessibilityRole="header" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[reviewStyles.headerSubtitle, themed.text]} numberOfLines={1} ellipsizeMode="middle">
            {subtitle}
          </Text>
        ) : null}
      </View>
    </View>
  );
};

interface ReviewActionsProps {
  retakeLabel: string;
  confirmLabel: string;
  isConfirming: boolean;
  /** Multi-capture: "Add more" is off once the limit is reached. */
  isRetakeDisabled?: boolean;
  /** The left button's icon: retake, or "add more" in the capture list. */
  retakeIcon?: 'retake' | 'add';
  /** Over a full-screen picture rather than below it. */
  isFloating?: boolean;
  bottomInset: number;
  theme: DocumentKitCameraTheme;
  onRetake: () => void;
  onConfirm: () => void;
}

/** Retake / Use bar shared by the photo and video reviews and the capture list. */
export const ReviewActions: React.FC<ReviewActionsProps> = ({
  retakeLabel,
  confirmLabel,
  isConfirming,
  isRetakeDisabled = false,
  retakeIcon = 'retake',
  isFloating = false,
  bottomInset,
  theme,
  onRetake,
  onConfirm,
}) => {
  const themed = useThemeStyles(theme);
  const LeftIcon = retakeIcon === 'add' ? PlusIcon : RetakeIcon;
  return (
    // The opaque bar keeps the buttons readable over any photo.
    <View
      style={[
        cameraStyles.reviewBottomBar,
        isFloating && cameraStyles.reviewBottomBarFloating,
        themed.screen,
        {paddingBottom: Math.max(bottomInset, 8) + 12},
      ]}>
      <Pressable
        onPress={onRetake}
        disabled={isConfirming || isRetakeDisabled}
        accessibilityRole="button"
        accessibilityLabel={retakeLabel}
        accessibilityState={{disabled: isConfirming || isRetakeDisabled}}
        style={({pressed}) => [
          cameraStyles.reviewButton,
          cameraStyles.retakeButton,
          themed.outlineBorder,
          (pressed || isConfirming || isRetakeDisabled) && cameraStyles.buttonDimmed,
        ]}>
        <LeftIcon color={theme.textColor} />
        <Text style={[cameraStyles.reviewButtonText, themed.text]}>{retakeLabel}</Text>
      </Pressable>
      <Pressable
        onPress={onConfirm}
        disabled={isConfirming}
        accessibilityRole="button"
        accessibilityLabel={confirmLabel}
        accessibilityState={{disabled: isConfirming, busy: isConfirming}}
        style={({pressed}) => [
          cameraStyles.reviewButton,
          cameraStyles.confirmButton,
          themed.primaryBorder,
          themed.primaryFill,
          pressed && cameraStyles.buttonDimmed,
        ]}>
        {isConfirming ? (
          <ActivityIndicator color={theme.onPrimaryColor} />
        ) : (
          <>
            <CheckIcon color={theme.onPrimaryColor} />
            <Text style={[cameraStyles.reviewButtonText, themed.onPrimaryText]}>{confirmLabel}</Text>
          </>
        )}
      </Pressable>
    </View>
  );
};

interface Size {
  width: number;
  height: number;
}

interface PhotoReviewProps {
  photo: NativeCapturedPhoto;
  review: Required<CameraReviewOptions>;
  labels: DocumentKitCameraLabels;
  theme: DocumentKitCameraTheme;
  insets: {top: number; bottom: number};
  isConfirming: boolean;
  /** The left button; defaults to labels.retake. */
  retakeLabel?: string;
  onClose: () => void;
  onRetake: () => void;
  /** With the edited copy when the photo was edited, otherwise the photo itself. */
  onConfirm: (photo: NativeCapturedPhoto) => void;
  onEditError: (error: unknown) => void;
}

/**
 * The captured photo with Retake / Use Photo, and a "Crop & Rotate" button
 * that opens the photo editor. Edits show on the screen-sized copy at once and
 * are applied to the full photo only when it is used.
 */
export const PhotoReview: React.FC<PhotoReviewProps> = ({
  photo,
  review,
  labels,
  theme,
  insets,
  isConfirming,
  retakeLabel,
  onClose,
  onRetake,
  onConfirm,
  onEditError,
}) => {
  const themed = useThemeStyles(theme);
  // The photo upright, as the screen-sized copy shows it.
  const [upright, setUpright] = useState<Size | null>(
    photo.width && photo.height ? {width: photo.width, height: photo.height} : null,
  );
  const [area, setArea] = useState<Size | null>(null);
  const [edits, setEdits] = useState<NativePhotoEdits>(NO_EDITS);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [hasEditFailed, setHasEditFailed] = useState(false);

  const isBusy = isConfirming || isSaving;
  const canEdit = review.crop || review.straighten || review.rotate || review.flip;

  useEffect(() => {
    if (upright) {
      return;
    }
    Image.getSize(
      photo.previewUri,
      (width, height) => setUpright({width, height}),
      () => setUpright({width: 3, height: 4}),
    );
  }, [upright, photo.previewUri]);

  const onAreaLayout = ({nativeEvent}: LayoutChangeEvent) =>
    setArea({width: nativeEvent.layout.width, height: nativeEvent.layout.height});

  const use = async () => {
    if (isUnedited(edits)) {
      onConfirm(photo);
      return;
    }
    setIsSaving(true);
    setHasEditFailed(false);
    try {
      onConfirm(await editNativePhoto(photo.uri, edits));
    } catch (error) {
      onEditError(error);
      setHasEditFailed(true);
    } finally {
      setIsSaving(false);
    }
  };

  if (isEditorOpen && upright) {
    return (
      <PhotoEditor
        previewUri={photo.previewUri}
        upright={upright}
        initialEdits={edits}
        review={review}
        labels={labels}
        theme={theme}
        insets={insets}
        onCancel={() => setIsEditorOpen(false)}
        onDone={next => {
          setEdits(next);
          setHasEditFailed(false);
          setIsEditorOpen(false);
        }}
      />
    );
  }

  const subtitle = [photo.name, photo.size ? formatFileSize(photo.size) : null].filter(Boolean).join(' · ');

  return (
    <View style={[cameraStyles.container, themed.screen]}>
      {review.header ? (
        <ReviewHeader
          title={labels.reviewPhoto}
          subtitle={subtitle}
          closeLabel={labels.close}
          theme={theme}
          topInset={insets.top}
          onClose={onClose}
        />
      ) : (
        <View style={{height: insets.top}} />
      )}

      <View style={reviewStyles.imageArea} onLayout={onAreaLayout}>
        {upright && area && area.width > 0 && area.height > 0 ? (
          <EditedPhoto uri={photo.previewUri} upright={upright} area={area} edits={edits} isFullFrame={false} />
        ) : null}
      </View>

      {hasEditFailed ? (
        <Text style={[reviewStyles.message, themed.text]} accessibilityLiveRegion="polite">
          {labels.editFailed}
        </Text>
      ) : null}

      {canEdit ? (
        <Pressable
          onPress={() => setIsEditorOpen(true)}
          disabled={isBusy || !upright}
          accessibilityRole="button"
          accessibilityLabel={labels.editPhoto}
          accessibilityState={{disabled: isBusy || !upright}}
          style={({pressed}) => [
            reviewStyles.editButton,
            themed.outlineBorder,
            (pressed || isBusy) && cameraStyles.buttonDimmed,
          ]}>
          <CropIcon color={theme.iconColor} size={20} />
          <Text style={[reviewStyles.toolText, themed.text]}>{labels.editPhoto}</Text>
        </Pressable>
      ) : null}

      <ReviewActions
        retakeLabel={retakeLabel ?? labels.retake}
        confirmLabel={labels.usePhoto}
        isConfirming={isBusy}
        bottomInset={insets.bottom}
        theme={theme}
        onRetake={onRetake}
        onConfirm={use}
      />
    </View>
  );
};
