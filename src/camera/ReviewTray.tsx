import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, View} from 'react-native';
import type {LayoutChangeEvent} from 'react-native';
import type {NativeCapturedPhoto, NativePhotoEdits} from '../specs/NativeDocumentKitCamera';
import type {NativePreviewLabels} from '../specs/NativeDocumentKitPreview';
import {EditedPhoto} from './EditedPhoto';
import {ArrowRightIcon, CloseIcon, CropIcon, PlayIcon, PlusIcon, TrashIcon} from './icons';
import {NO_EDITS, isUnedited} from './photoEdits';
import {PhotoEditor} from './PhotoEditor';
import {ReorderableStrip} from './ReorderableStrip';
import {
  TRAY_THUMBNAIL_BORDER,
  TRAY_THUMBNAIL_SIZE,
  cameraStyles,
  formatDuration,
  recordingStyles,
  trayStyles,
  useThemeStyles,
} from './styles';
import type {CameraReviewOptions, DocumentKitCameraLabels, DocumentKitCameraTheme} from './types';
import {playRecording} from './VideoReview';

export interface TrayItem {
  key: string;
  /** Screen-sized photo or video poster. */
  thumbnailUri: string;
  /** Photos: what the editor works on, and its edits so far. */
  photo?: NativeCapturedPhoto;
  edits?: NativePhotoEdits;
  /** Videos only: played in DocumentKit's player when tapped. */
  videoUri?: string;
  durationSeconds?: number;
}

interface Size {
  width: number;
  height: number;
}

interface ReviewTrayProps {
  items: TrayItem[];
  canAddMore: boolean;
  isConfirming: boolean;
  /** The last attempt to save the edited photos failed. */
  hasEditFailed: boolean;
  review: Required<CameraReviewOptions>;
  theme: DocumentKitCameraTheme;
  labels: DocumentKitCameraLabels;
  playerLabels: NativePreviewLabels;
  insets: {top: number; bottom: number};
  /** The top-left button: back to the camera, or close the review (library picks). */
  closeLabel: string;
  onClose: () => void;
  onRemove: (key: string) => void;
  onEdit: (key: string, edits: NativePhotoEdits) => void;
  /** Moves a capture to toIndex; the order is the order they are attached in. */
  onReorder: (key: string, toIndex: number) => void;
  onAddMore: () => void;
  onDone: () => void;
  onPlaybackError: (error: unknown) => void;
}

// Photos without a reported size are shown at the usual camera shape.
const FALLBACK_SIZE: Size = {width: 3, height: 4};

// Hold a thumbnail this long to lift it and drag it to a new place.
const LIFT_DELAY_MS = 300;
const MOVE_EARLIER = 'moveEarlier';
const MOVE_LATER = 'moveLater';

const keyOfItem = (item: TrayItem) => item.key;

const THUMBNAIL_AREA: Size = {
  width: TRAY_THUMBNAIL_SIZE - 2 * TRAY_THUMBNAIL_BORDER,
  height: TRAY_THUMBNAIL_SIZE - 2 * TRAY_THUMBNAIL_BORDER,
};

const uprightOf = (photo: NativeCapturedPhoto): Size =>
  photo.width && photo.height ? {width: photo.width, height: photo.height} : FALLBACK_SIZE;

/** A photo's thumbnail shows its crop and rotation; unedited ones are a plain image. */
const renderThumbnail = (item: TrayItem) =>
  item.photo && item.edits && !isUnedited(item.edits) ? (
    <View style={trayStyles.thumbnailEdited}>
      <EditedPhoto
        uri={item.photo.previewUri}
        upright={uprightOf(item.photo)}
        area={THUMBNAIL_AREA}
        edits={item.edits}
        isFullFrame={false}
        isFilled={true}
      />
    </View>
  ) : (
    <Image source={{uri: item.thumbnailUri}} style={trayStyles.thumbnailImage} resizeMode="cover" />
  );

/** Screen readers move a capture one place at a time instead of dragging. */
const reorderActions = (itemIndex: number, count: number, labels: DocumentKitCameraLabels) => [
  ...(itemIndex > 0 ? [{name: MOVE_EARLIER, label: labels.moveEarlier}] : []),
  ...(itemIndex < count - 1 ? [{name: MOVE_LATER, label: labels.moveLater}] : []),
];

const titleFor = (items: TrayItem[], labels: DocumentKitCameraLabels): string => {
  const videos = items.filter(item => item.videoUri).length;
  if (videos === 0) {
    return labels.reviewPhotos;
  }
  return videos === items.length ? labels.reviewVideos : labels.reviewCaptures;
};

/** "Attach 3 photos": the label for what is there, with {count} filled in. */
const attachLabelFor = (items: TrayItem[], labels: DocumentKitCameraLabels): string => {
  const videos = items.filter(item => item.videoUri).length;
  const isSingle = items.length === 1;
  let label = labels.attachFiles;
  if (videos === 0) {
    label = isSingle ? labels.attachPhoto : labels.attachPhotos;
  } else if (videos === items.length) {
    label = isSingle ? labels.attachVideo : labels.attachVideos;
  }
  return label.replace('{count}', String(items.length));
};

/**
 * Multi-capture review: the captures full screen (swipe or pick a thumbnail),
 * each photo editable with Crop & Rotate, removable, reordered by holding and
 * dragging its thumbnail, with a "+" tile back to the camera and one button
 * that attaches them all in that order.
 */
export const ReviewTray: React.FC<ReviewTrayProps> = ({
  items,
  canAddMore,
  isConfirming,
  hasEditFailed,
  review,
  theme,
  labels,
  playerLabels,
  insets,
  closeLabel,
  onClose,
  onRemove,
  onEdit,
  onReorder,
  onAddMore,
  onDone,
  onPlaybackError,
}) => {
  const themed = useThemeStyles(theme);
  const [index, setIndex] = useState(0);
  const [viewer, setViewer] = useState<Size | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  // After a reorder: the capture shown, to keep showing it at its new place.
  const [followKey, setFollowKey] = useState<string | null>(null);
  const pages = useRef<FlatList<TrayItem>>(null);

  const current = items[Math.min(index, items.length - 1)];
  const canEdit = review.crop || review.straighten || review.rotate || review.flip;

  // Removing the last capture leaves the index past the end.
  useEffect(() => {
    if (index > items.length - 1) {
      setIndex(Math.max(items.length - 1, 0));
    }
  }, [index, items.length]);

  // Before paint, so the big view does not flash the capture that took its place.
  useLayoutEffect(() => {
    if (followKey === null) {
      return;
    }
    setFollowKey(null);
    const followed = items.findIndex(item => item.key === followKey);
    if (followed >= 0) {
      setIndex(followed);
      pages.current?.scrollToIndex({index: followed, animated: false});
    }
  }, [followKey, items]);

  const select = (next: number) => {
    setIndex(next);
    pages.current?.scrollToIndex({index: next, animated: true});
  };

  const reorder = (key: string, toIndex: number) => {
    if (toIndex < 0 || toIndex >= items.length) {
      return;
    }
    if (current) {
      setFollowKey(current.key);
    }
    onReorder(key, toIndex);
  };

  const onViewerLayout = ({nativeEvent}: LayoutChangeEvent) =>
    setViewer({width: nativeEvent.layout.width, height: nativeEvent.layout.height});

  const editing = items.find(item => item.key === editingKey);
  if (editing?.photo) {
    return (
      <PhotoEditor
        previewUri={editing.photo.previewUri}
        upright={uprightOf(editing.photo)}
        initialEdits={editing.edits ?? NO_EDITS}
        review={review}
        labels={labels}
        theme={theme}
        insets={insets}
        onCancel={() => setEditingKey(null)}
        onDone={edits => {
          onEdit(editing.key, edits);
          setEditingKey(null);
        }}
      />
    );
  }

  const renderPage = (item: TrayItem, size: Size) => {
    if (item.photo) {
      return (
        <EditedPhoto
          uri={item.photo.previewUri}
          upright={uprightOf(item.photo)}
          area={size}
          edits={item.edits ?? NO_EDITS}
          isFullFrame={false}
        />
      );
    }
    const videoUri = item.videoUri;
    return (
      <>
        <Image source={{uri: item.thumbnailUri}} style={StyleSheet.absoluteFill} resizeMode="contain" />
        <View style={[StyleSheet.absoluteFill, themed.posterScrim]} />
        <View style={recordingStyles.videoPoster}>
          <Pressable
            onPress={() =>
              videoUri && playRecording(videoUri, labels.videoMode, playerLabels, theme, onPlaybackError)
            }
            disabled={isConfirming}
            accessibilityRole="button"
            accessibilityLabel={labels.playVideo}
            style={[recordingStyles.playButton, themed.playButton]}>
            <PlayIcon color={theme.iconColor} size={34} />
          </Pressable>
          {item.durationSeconds !== undefined ? (
            <Text style={[recordingStyles.duration, themed.text]}>{formatDuration(item.durationSeconds)}</Text>
          ) : null}
        </View>
      </>
    );
  };

  const roundButton = [trayStyles.roundButton, themed.overlay];

  return (
    <View style={[cameraStyles.container, themed.screen]}>
      <View style={StyleSheet.absoluteFill} onLayout={onViewerLayout}>
        {viewer ? (
          <FlatList
            ref={pages}
            data={items}
            keyExtractor={item => item.key}
            horizontal={true}
            pagingEnabled={true}
            showsHorizontalScrollIndicator={false}
            getItemLayout={(_, page) => ({length: viewer.width, offset: viewer.width * page, index: page})}
            // Remounted after Crop & Rotate (the editor replaces the tray): open on the photo just edited.
            initialScrollIndex={Math.max(Math.min(index, items.length - 1), 0)}
            onMomentumScrollEnd={event => setIndex(Math.round(event.nativeEvent.contentOffset.x / viewer.width))}
            renderItem={({item}) => (
              <View style={[trayStyles.page, {width: viewer.width, height: viewer.height}]}>
                {renderPage(item, viewer)}
              </View>
            )}
          />
        ) : null}
      </View>

      <View style={[trayStyles.header, {paddingTop: insets.top + 8}]}>
        <Pressable
          onPress={onClose}
          disabled={isConfirming}
          accessibilityRole="button"
          accessibilityLabel={closeLabel}
          style={roundButton}>
          <CloseIcon color={theme.iconColor} size={22} />
        </Pressable>
        <View style={trayStyles.titles}>
          {review.header ? (
            <>
              <Text style={[trayStyles.title, themed.text]} accessibilityRole="header" numberOfLines={1}>
                {titleFor(items, labels)}
              </Text>
              <Text style={[trayStyles.counter, themed.text]}>{`${Math.min(index + 1, items.length)} / ${items.length}`}</Text>
            </>
          ) : null}
        </View>
        {canEdit && current?.photo ? (
          <Pressable
            onPress={() => setEditingKey(current.key)}
            disabled={isConfirming}
            accessibilityRole="button"
            accessibilityLabel={labels.editPhoto}
            style={roundButton}>
            <CropIcon color={theme.iconColor} size={22} />
          </Pressable>
        ) : null}
        {review.remove && current ? (
          <Pressable
            onPress={() => onRemove(current.key)}
            disabled={isConfirming}
            accessibilityRole="button"
            accessibilityLabel={labels.deleteCapture}
            style={roundButton}>
            <TrashIcon color={theme.iconColor} />
          </Pressable>
        ) : null}
      </View>

      <View style={[trayStyles.sheet, themed.surface, {paddingBottom: Math.max(insets.bottom, 8) + 12}]}>
        <View style={[trayStyles.handle, themed.iconFill]} />
        <ReorderableStrip
          items={items}
          keyOf={keyOfItem}
          isReorderEnabled={review.reorder && !isConfirming}
          contentContainerStyle={trayStyles.thumbnails}
          onReorder={reorder}
          renderItem={(item, itemIndex, {isDragging, startDrag, endDragIfIdle}) => {
            const isSelected = itemIndex === index;
            return (
              <View style={trayStyles.thumbnailSlot}>
                <Pressable
                  onPress={() => select(itemIndex)}
                  onLongPress={review.reorder ? startDrag : undefined}
                  onPressOut={endDragIfIdle}
                  delayLongPress={LIFT_DELAY_MS}
                  accessibilityRole="imagebutton"
                  accessibilityState={{selected: isSelected}}
                  accessibilityLabel={`${itemIndex + 1} / ${items.length}`}
                  accessibilityActions={review.reorder ? reorderActions(itemIndex, items.length, labels) : undefined}
                  onAccessibilityAction={({nativeEvent}) =>
                    reorder(item.key, nativeEvent.actionName === MOVE_EARLIER ? itemIndex - 1 : itemIndex + 1)
                  }
                  style={[trayStyles.thumbnail, isSelected ? themed.primaryBorder : trayStyles.thumbnailIdle]}>
                  {renderThumbnail(item)}
                  {item.videoUri ? (
                    <View style={trayStyles.thumbnailPlay}>
                      <PlayIcon color={theme.iconColor} size={18} />
                    </View>
                  ) : null}
                </Pressable>
                {review.remove && !isDragging ? (
                  <Pressable
                    onPress={() => onRemove(item.key)}
                    disabled={isConfirming}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={labels.removeCapture}
                    style={[trayStyles.removeBadge, themed.iconFill]}>
                    <CloseIcon color={theme.backgroundColor} size={12} />
                  </Pressable>
                ) : null}
              </View>
            );
          }}
          footer={
            review.addMore && canAddMore ? (
              <Pressable
                onPress={onAddMore}
                disabled={isConfirming}
                accessibilityRole="button"
                accessibilityLabel={labels.addMore}
                style={[trayStyles.addTile, themed.playButton]}>
                <PlusIcon color={theme.iconColor} />
              </Pressable>
            ) : null
          }
        />

        {hasEditFailed ? (
          <Text style={[trayStyles.message, themed.text]} accessibilityLiveRegion="polite">
            {labels.editFailed}
          </Text>
        ) : null}

        <Pressable
          onPress={onDone}
          disabled={isConfirming || items.length === 0}
          accessibilityRole="button"
          accessibilityState={{disabled: isConfirming, busy: isConfirming}}
          style={({pressed}) => [trayStyles.attach, themed.primaryFill, pressed && cameraStyles.buttonDimmed]}>
          {isConfirming ? (
            <ActivityIndicator color={theme.onPrimaryColor} />
          ) : (
            <>
              <Text style={[trayStyles.attachLabel, themed.onPrimaryText]}>{attachLabelFor(items, labels)}</Text>
              <ArrowRightIcon color={theme.onPrimaryColor} />
            </>
          )}
        </Pressable>
      </View>
    </View>
  );
};
