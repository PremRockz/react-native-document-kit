import React, {useState} from 'react';
import {Modal, Platform, StatusBar} from 'react-native';
import type {DocumentKitErrorReporter, PickResult, PickedFile} from '../core/types';
import type {NativeCapturedPhoto, NativePhotoEdits} from '../specs/NativeDocumentKitCamera';
import type {NativePreviewLabels} from '../specs/NativeDocumentKitPreview';
import {buildCapturedFile} from './capturedFiles';
import {editNativePhoto} from './nativeCamera';
import {isUnedited} from './photoEdits';
import {PhotoReview} from './PhotoReview';
import {ReviewTray} from './ReviewTray';
import {FALLBACK_INSETS} from './styles';
import type {CameraReviewOptions, DocumentKitCameraLabels, DocumentKitCameraTheme} from './types';

/** Photos picked from the library, waiting for the review. */
export interface LibraryReviewSession {
  files: PickedFile[];
  review: Required<CameraReviewOptions>;
  /** As pickFromLibrary's: 1 reviews one photo, 0 means no limit. */
  selectionLimit: number;
}

interface LibraryReviewModalProps {
  /** The open review, or null when there is none. */
  session: LibraryReviewSession | null;
  theme: DocumentKitCameraTheme;
  labels: DocumentKitCameraLabels;
  playerLabels: NativePreviewLabels;
  /** Called exactly once per session with the outcome. */
  onResult: (result: PickResult) => void;
  /** Opens the photo picker again for up to `limit` more (0: no limit); resolves none when cancelled. */
  onPickMore: (limit: number) => Promise<PickedFile[]>;
  reportError: DocumentKitErrorReporter;
}

// Android 16 enforces edge-to-edge, so the modal must draw under the system bars.
const IS_ANDROID_16 = Platform.OS === 'android' && Platform.Version >= 36;

/**
 * The review has no camera view to measure the safe area, so it estimates it:
 * the status bar on Android 16 (edge to edge), nothing on older Android, and
 * the usual notch on iOS.
 */
const REVIEW_INSETS: {top: number; bottom: number} = Platform.select({
  ios: {top: FALLBACK_INSETS.top, bottom: FALLBACK_INSETS.bottom},
  default: IS_ANDROID_16 ? {top: StatusBar.currentHeight ?? 24, bottom: 24} : {top: 0, bottom: 0},
});

/** Photos the review can show and edit: not videos, and not GIFs (editing would freeze them). */
export const isReviewablePhoto = (file: PickedFile): boolean =>
  file.mimeType.startsWith('image/') && file.mimeType !== 'image/gif';

/** A picked file in the shape the review screens work with; it is already screen-ready. */
const toReviewPhoto = (file: PickedFile): NativeCapturedPhoto => ({
  uri: file.uri,
  name: file.name,
  mimeType: file.mimeType,
  size: file.size,
  width: file.width,
  height: file.height,
  previewUri: file.uri,
});

/** The edited copy as a library file, keeping the name the user picked. */
const toEditedFile = (original: PickedFile, edited: NativeCapturedPhoto): PickedFile => ({
  ...buildCapturedFile(edited, 'library'),
  name: `${original.baseName}.jpg`,
  baseName: original.baseName,
});

interface ContentProps extends Omit<LibraryReviewModalProps, 'session'> {
  session: LibraryReviewSession;
}

const LibraryReviewContent: React.FC<ContentProps> = ({
  session,
  theme,
  labels,
  playerLabels,
  onResult,
  onPickMore,
  reportError,
}) => {
  const [files, setFiles] = useState(session.files);
  // Keyed by uri: each picked file is its own copy in the cache.
  const [editsByUri, setEditsByUri] = useState<Record<string, NativePhotoEdits>>({});
  const [isConfirming, setIsConfirming] = useState(false);
  const [hasEditFailed, setHasEditFailed] = useState(false);
  const [isPicking, setIsPicking] = useState(false);

  const cancel = () => onResult({status: 'cancelled'});
  const reportEditError = (error: unknown) => reportError(error, {operation: 'photo_edit'});

  const pickMore = async (limit: number): Promise<PickedFile[]> => {
    if (isPicking) {
      return [];
    }
    setIsPicking(true);
    try {
      return await onPickMore(limit);
    } finally {
      setIsPicking(false);
    }
  };

  /** Writes each edited photo's copy, then hands them all over in order. */
  const attach = async () => {
    if (files.length === 0 || isConfirming) {
      return;
    }
    setIsConfirming(true);
    setHasEditFailed(false);
    try {
      const result: PickedFile[] = [];
      // One at a time: each edit decodes a full photo.
      for (const file of files) {
        const edits = editsByUri[file.uri];
        result.push(
          edits && !isUnedited(edits) ? toEditedFile(file, await editNativePhoto(file.uri, edits)) : file,
        );
      }
      onResult({status: 'picked', files: result});
    } catch (error) {
      reportEditError(error);
      setHasEditFailed(true);
      setIsConfirming(false);
    }
  };

  if (session.selectionLimit === 1 && files[0]) {
    const file = files[0];
    return (
      <PhotoReview
        // A new pick starts a fresh review.
        key={file.uri}
        photo={toReviewPhoto(file)}
        review={session.review}
        labels={labels}
        theme={theme}
        insets={REVIEW_INSETS}
        isConfirming={isConfirming}
        retakeLabel={labels.chooseAnother}
        onClose={cancel}
        onRetake={async () => {
          const [another] = await pickMore(1);
          if (another) {
            setFiles([another]);
          }
        }}
        onConfirm={photo =>
          onResult({status: 'picked', files: [photo.uri === file.uri ? file : toEditedFile(file, photo)]})
        }
        onEditError={reportEditError}
      />
    );
  }

  const canAddMore = session.selectionLimit === 0 || files.length < session.selectionLimit;
  return (
    <ReviewTray
      items={files.map(file => ({
        key: file.uri,
        thumbnailUri: file.uri,
        photo: toReviewPhoto(file),
        edits: editsByUri[file.uri],
      }))}
      canAddMore={canAddMore}
      isConfirming={isConfirming}
      hasEditFailed={hasEditFailed}
      review={session.review}
      theme={theme}
      labels={labels}
      playerLabels={playerLabels}
      insets={REVIEW_INSETS}
      closeLabel={labels.closeReview}
      onClose={cancel}
      onRemove={uri => {
        const next = files.filter(file => file.uri !== uri);
        if (next.length === 0) {
          cancel();
          return;
        }
        setFiles(next);
      }}
      onReorder={(uri, toIndex) => {
        const moving = files.find(file => file.uri === uri);
        if (!moving) {
          return;
        }
        const rest = files.filter(file => file.uri !== uri);
        setFiles([...rest.slice(0, toIndex), moving, ...rest.slice(toIndex)]);
      }}
      onEdit={(uri, edits) => {
        setEditsByUri(current => ({...current, [uri]: edits}));
        setHasEditFailed(false);
      }}
      onAddMore={async () => {
        const remaining = session.selectionLimit === 0 ? 0 : session.selectionLimit - files.length;
        const more = await pickMore(remaining);
        const known = new Set(files.map(file => file.uri));
        setFiles(current => [...current, ...more.filter(file => !known.has(file.uri))]);
      }}
      onDone={() => void attach()}
      onPlaybackError={error => reportError(error, {operation: 'library_pick'})}
    />
  );
};

/**
 * pickFromLibrary's review: the camera's review screens for picked photos, so
 * they can be cropped, rotated, removed, reordered or added to before use.
 */
export const LibraryReviewModal: React.FC<LibraryReviewModalProps> = ({session, onResult, ...contentProps}) => (
  <Modal
    visible={session !== null}
    transparent={true}
    animationType="fade"
    onRequestClose={() => onResult({status: 'cancelled'})}
    {...(IS_ANDROID_16 && {statusBarTranslucent: true, navigationBarTranslucent: true})}>
    {session ? <LibraryReviewContent session={session} onResult={onResult} {...contentProps} /> : null}
  </Modal>
);
