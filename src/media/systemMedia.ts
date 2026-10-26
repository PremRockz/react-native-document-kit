import {getExtension} from '../core/fileUtils';
import type {
  DocumentKitErrorReporter,
  DocumentKitOperation,
  FileSource,
  PickErrorCode,
  PickResult,
  PickedFile,
} from '../core/types';
import type {CameraReviewOptions} from '../camera/types';
import NativeDocumentKitMediaPicker from '../specs/NativeDocumentKitMediaPicker';
import type {
  NativePickResponse,
  NativePickedFile,
} from '../specs/NativeDocumentKitMediaPicker';

export type VideoQuality = 'low' | 'medium' | 'high';
export type LibraryMediaType = 'photo' | 'video' | 'mixed';

export interface RecordVideoOptions {
  /**
   * Defaults to "auto": picked from the network (upload speed, connection type,
   * data saver). The OS camera on Android only distinguishes low from medium/high.
   */
  quality?: VideoQuality | 'auto';
  /** 0 or omitted means no limit. */
  maxDurationSeconds?: number;
  /**
   * In-app camera only. Defaults to true: sound is recorded when the microphone
   * is allowed, and the camera shows a microphone switch. false records without
   * sound, never asks for the microphone and hides the switch.
   */
  audio?: boolean;
}

export interface PickFromLibraryOptions {
  /** Defaults to "mixed" (photos and videos). */
  mediaType?: LibraryMediaType;
  /**
   * Several items in one pick. Defaults to false; false always picks one.
   * With true, selectionLimit caps how many (no limit by default).
   */
  allowMultiple?: boolean;
  /**
   * The most items to pick: 1 by default, or no limit (0) with allowMultiple.
   * A value above 1 alone (without allowMultiple) also allows several.
   */
  selectionLimit?: number;
  /**
   * Off by default. true (or options) shows the camera's review after picking
   * photos: one photo with Crop & Rotate and "Choose another", several with the
   * multi-photo review ("+" picks more, up to selectionLimit). Every part is on
   * unless switched off, as for the camera. Picks with a video or a GIF skip it.
   */
  review?: boolean | CameraReviewOptions;
}

export interface PickDocumentsOptions {
  /** MIME types, wildcards allowed ("image/*"). Omitted or empty allows every file type. */
  mimeTypes?: string[];
  /** Defaults to false. */
  allowMultiple?: boolean;
}

const toWholeNonNegative = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;

const getNativeErrorCode = (error: unknown): string | undefined =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  typeof error.code === 'string'
    ? error.code
    : undefined;

const toPickedFile = (file: NativePickedFile, source: FileSource): PickedFile => {
  const extension = getExtension(file.name);
  return {
    uri: file.uri,
    name: file.name,
    baseName: extension
      ? file.name.slice(0, -(extension.length + 1))
      : file.name,
    extension,
    mimeType: file.mimeType,
    size: file.size,
    width: file.width,
    height: file.height,
    durationMs: file.durationMs,
    source,
  };
};

const toPickResult = (
  response: NativePickResponse,
  source: FileSource,
): PickResult =>
  response.cancelled || response.files.length === 0
    ? {status: 'cancelled'}
    : {status: 'picked', files: response.files.map(file => toPickedFile(file, source))};

const toFailureResult = (
  error: unknown,
  fallbackCode: PickErrorCode,
  operation: DocumentKitOperation,
  reportError: DocumentKitErrorReporter,
): PickResult => {
  switch (getNativeErrorCode(error)) {
    case 'E_UNAVAILABLE':
      return {status: 'unavailable', reason: 'no_camera_device'};
    case 'E_BUSY':
      return {status: 'error', code: 'busy'};
    default:
      reportError(error, {operation});
      return {status: 'error', code: fallbackCode};
  }
};

/** Opens the OS camera app. The caller must have camera permission. */
export const captureWithSystemCamera = async (
  mediaType: 'photo' | 'video',
  options: RecordVideoOptions,
  reportError: DocumentKitErrorReporter,
): Promise<PickResult> => {
  try {
    const quality = options.quality === 'auto' ? undefined : options.quality;
    const response = await NativeDocumentKitMediaPicker.captureWithSystemCamera(
      mediaType,
      quality ?? 'high',
      toWholeNonNegative(options.maxDurationSeconds ?? 0),
    );
    return toPickResult(
      response,
      mediaType === 'video' ? 'camera_video' : 'camera_photo',
    );
  } catch (error) {
    return toFailureResult(
      error,
      'capture_failed',
      'system_camera_capture',
      reportError,
    );
  }
};

/**
 * Opens the Files app (iOS) or the system file picker (Android). Needs no
 * permission; cloud files are downloaded and copied into the app cache.
 */
export const pickSystemDocuments = async (
  options: PickDocumentsOptions,
  reportError: DocumentKitErrorReporter,
): Promise<PickResult> => {
  try {
    const response = await NativeDocumentKitMediaPicker.pickDocuments(
      options.mimeTypes ?? [],
      options.allowMultiple ?? false,
    );
    return toPickResult(response, 'documents');
  } catch (error) {
    return toFailureResult(error, 'pick_failed', 'document_pick', reportError);
  }
};

/** How many items a pick allows: 1, a number, or 0 for no limit. */
export const resolveSelectionLimit = ({allowMultiple, selectionLimit}: PickFromLibraryOptions): number => {
  if (allowMultiple === false) {
    return 1;
  }
  return toWholeNonNegative(selectionLimit ?? (allowMultiple ? 0 : 1));
};

/** Opens the system photo picker. Needs no permission on either platform. */
export const pickFromSystemLibrary = async (
  options: PickFromLibraryOptions,
  reportError: DocumentKitErrorReporter,
): Promise<PickResult> => {
  try {
    const response = await NativeDocumentKitMediaPicker.pickFromLibrary(
      options.mediaType ?? 'mixed',
      resolveSelectionLimit(options),
    );
    return toPickResult(response, 'library');
  } catch (error) {
    return toFailureResult(error, 'pick_failed', 'library_pick', reportError);
  }
};
