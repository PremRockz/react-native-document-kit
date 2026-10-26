import {Platform} from 'react-native';
import type {EventSubscription} from 'react-native';
import {ensureNotificationPermission} from '../camera/cameraPermission';
import {isUnauthorizedStatus, mergeHeaders, refreshHeaders} from '../core/unauthorized';
import type {UnauthorizedHandler} from '../core/unauthorized';
import NativeDocumentKitDownloader from '../specs/NativeDocumentKitDownloader';
import type {
  NativeDownloadNotification,
  NativeDownloadProgress,
  NativeDownloadedFile,
} from '../specs/NativeDocumentKitDownloader';

/**
 * Android notification for a download: progress while downloading, then
 * "Downloaded" (tap opens the saved file). Ignored on iOS, where the Save to
 * Files sheet and the app's own message confirm the save.
 */
export interface DownloadNotification {
  /** Use the same tag for downloadFile and saveToDevice so one notification updates. */
  tag: string;
  /** Usually the file name. */
  title: string;
  /** Name of the channel in Android's notification settings. Defaults to "Downloads". */
  channelName?: string;
  /** Defaults to "Downloading…". */
  downloading?: string;
  /** Defaults to "Downloaded". */
  downloaded?: string;
  /** Close button of the PDF viewer the notification opens. Defaults to "Close". */
  close?: string;
}

/** English text for whatever the caller leaves out. */
export const DEFAULT_NOTIFICATION_LABELS = {
  channelName: 'Downloads',
  downloading: 'Downloading…',
  downloaded: 'Downloaded',
  close: 'Close',
} as const;

const toNativeNotification = (
  notification: DownloadNotification | undefined,
): NativeDownloadNotification | null =>
  notification
    ? {
        tag: notification.tag,
        title: notification.title,
        channelName: notification.channelName ?? DEFAULT_NOTIFICATION_LABELS.channelName,
        downloadingText: notification.downloading ?? DEFAULT_NOTIFICATION_LABELS.downloading,
        completedText: notification.downloaded ?? DEFAULT_NOTIFICATION_LABELS.downloaded,
        closeLabel: notification.close ?? DEFAULT_NOTIFICATION_LABELS.close,
      }
    : null;

/**
 * Asks once, in context, the first time a download wants a notification.
 * A refusal or a failed check never blocks the download.
 */
const allowNotificationsIfWanted = async (
  notification: DownloadNotification | undefined,
): Promise<void> => {
  if (!notification || Platform.OS !== 'android') {
    return;
  }
  try {
    await ensureNotificationPermission();
  } catch {
    // Without permission the native side simply skips the notification.
    return;
  }
};

export interface DownloadProgress {
  bytesWritten: number;
  /** null when the server does not send a length. */
  totalBytes: number | null;
  /** 0–1, or null when the total is unknown. */
  fraction: number | null;
}

export interface DownloadRequest {
  url: string;
  /** Name for the cached copy; spaces and path characters are replaced. */
  fileName: string;
  /**
   * Identifies the file in the cache, e.g. "<account>:<documentId>".
   * Defaults to the URL. The same key is served from cache without a request.
   */
  cacheKey?: string;
  headers?: Record<string, string>;
  onProgress?: (progress: DownloadProgress) => void;
  signal?: AbortSignal;
  /** Android progress notification; see DownloadNotification. */
  notification?: DownloadNotification;
  /**
   * Fetches the file again even if this cacheKey is cached (and replaces the
   * cached copy), e.g. when the file may have changed on the server. Defaults to false.
   */
  forceRefresh?: boolean;
  /**
   * On 401/403: return fresh headers to retry once. Defaults to the provider's
   * onUnauthorized, so most apps set it there instead.
   */
  onUnauthorized?: UnauthorizedHandler;
}

export type DownloadedFile = NativeDownloadedFile;

/** 'unauthorized': the server answered 401 or 403 (and a session refresh, if any, did not help). */
export type DownloadFailureReason = 'network' | 'http' | 'unauthorized' | 'storage';

export type DownloadResult =
  | {status: 'downloaded'; file: DownloadedFile}
  | {status: 'cancelled'}
  | {
      status: 'failed';
      reason: DownloadFailureReason;
      httpStatus?: number;
      /** For the host app's monitoring; never show it to the user. */
      error: unknown;
    };

/** One native download, shared by every caller asking for the same cache key. */
interface SharedDownload {
  downloadId: string;
  result: Promise<DownloadResult>;
  progressListeners: Set<(progress: DownloadProgress) => void>;
  activeCallers: number;
}

const CANCELLED: DownloadResult = {status: 'cancelled'};

const downloadsByCacheKey = new Map<string, SharedDownload>();
const downloadsById = new Map<string, SharedDownload>();
let progressSubscription: EventSubscription | null = null;
let nextDownloadNumber = 1;

const toProgress = (event: NativeDownloadProgress): DownloadProgress => {
  const totalBytes = event.totalBytes > 0 ? event.totalBytes : null;
  return {
    bytesWritten: event.bytesWritten,
    totalBytes,
    fraction: totalBytes ? Math.min(event.bytesWritten / totalBytes, 1) : null,
  };
};

const subscribeToProgress = () => {
  progressSubscription ??= NativeDocumentKitDownloader.onDownloadProgress(event => {
    const download = downloadsById.get(event.downloadId);
    if (!download) {
      return;
    }
    const progress = toProgress(event);
    download.progressListeners.forEach(listener => listener(progress));
  });
};

const unsubscribeWhenIdle = () => {
  if (downloadsById.size === 0) {
    progressSubscription?.remove();
    progressSubscription = null;
  }
};

const readErrorCode = (error: unknown): unknown =>
  typeof error === 'object' && error !== null && 'code' in error
    ? error.code
    : undefined;

const readHttpStatus = (error: unknown): number | undefined => {
  const userInfo =
    typeof error === 'object' && error !== null && 'userInfo' in error
      ? error.userInfo
      : undefined;
  const status =
    typeof userInfo === 'object' && userInfo !== null && 'status' in userInfo
      ? userInfo.status
      : undefined;
  return typeof status === 'number' ? status : undefined;
};

const toFailureResult = (error: unknown): DownloadResult => {
  switch (readErrorCode(error)) {
    case 'E_CANCELLED':
      return CANCELLED;
    case 'E_HTTP': {
      const httpStatus = readHttpStatus(error);
      return {
        status: 'failed',
        reason: isUnauthorizedStatus(httpStatus) ? 'unauthorized' : 'http',
        httpStatus,
        error,
      };
    }
    case 'E_STORAGE':
      return {status: 'failed', reason: 'storage', error};
    default:
      return {status: 'failed', reason: 'network', error};
  }
};

const startSharedDownload = (
  request: DownloadRequest,
  cacheKey: string,
): SharedDownload => {
  const downloadId = `document-kit-download-${nextDownloadNumber++}`;
  const progressListeners = new Set<(progress: DownloadProgress) => void>();

  const result = NativeDocumentKitDownloader.download(
    downloadId,
    request.url,
    request.headers ?? {},
    cacheKey,
    request.fileName,
    toNativeNotification(request.notification),
    request.forceRefresh ?? false,
  )
    .then(
      (file): DownloadResult => ({status: 'downloaded', file}),
      toFailureResult,
    )
    .finally(() => {
      downloadsByCacheKey.delete(cacheKey);
      downloadsById.delete(downloadId);
      unsubscribeWhenIdle();
    });

  const download: SharedDownload = {
    downloadId,
    result,
    progressListeners,
    activeCallers: 0,
  };
  downloadsByCacheKey.set(cacheKey, download);
  downloadsById.set(downloadId, download);
  return download;
};

/**
 * Downloads into DocumentKit's cache, or returns the cached copy without a request.
 * Retries with backoff and resumes partial downloads when the server supports
 * ranges. On 401/403, asks onUnauthorized for fresh headers and tries once more.
 * Never rejects.
 */
export const downloadFile = async (request: DownloadRequest): Promise<DownloadResult> => {
  const result = await downloadOnce(request);
  if (result.status !== 'failed' || result.reason !== 'unauthorized') {
    return result;
  }
  const fresh = await refreshHeaders(request.url, result.httpStatus ?? 401, request.onUnauthorized);
  if (request.signal?.aborted) {
    return CANCELLED;
  }
  return fresh ? downloadOnce({...request, headers: mergeHeaders(request.headers ?? {}, fresh)}) : result;
};

const downloadOnce = async (request: DownloadRequest): Promise<DownloadResult> => {
  await allowNotificationsIfWanted(request.notification);
  if (request.signal?.aborted) {
    return CANCELLED;
  }
  subscribeToProgress();
  const cacheKey = request.cacheKey ?? request.url;
  const download =
    downloadsByCacheKey.get(cacheKey) ?? startSharedDownload(request, cacheKey);
  download.activeCallers += 1;
  if (request.onProgress) {
    download.progressListeners.add(request.onProgress);
  }

  return new Promise<DownloadResult>(resolve => {
    let isSettled = false;

    const settle = (result: DownloadResult) => {
      if (isSettled) {
        return;
      }
      isSettled = true;
      download.activeCallers -= 1;
      request.signal?.removeEventListener('abort', onAbort);
      if (request.onProgress) {
        download.progressListeners.delete(request.onProgress);
      }
      resolve(result);
    };

    // Resolves this caller at once; the transfer only stops when nobody else waits for it.
    function onAbort() {
      settle(CANCELLED);
      if (download.activeCallers === 0) {
        NativeDocumentKitDownloader.cancelDownload(download.downloadId);
      }
    }

    request.signal?.addEventListener('abort', onAbort);
    download.result.then(settle);
  });
};

export interface SaveToDeviceOptions {
  /** Android only: folder under Download/, e.g. "MyApp/acme". */
  subdirectory?: string;
  /** Android "Downloaded" notification; replaces the progress one with the same tag. */
  notification?: DownloadNotification;
}

export type SaveToDeviceResult =
  | {status: 'saved'; location: string}
  /** iOS: the user closed the Save to Files sheet. */
  | {status: 'cancelled'}
  | {status: 'failed'; error: unknown};

export interface SaveableFile {
  /** file:// (any platform) or content:// (Android). */
  uri: string;
  /** Name the saved file gets. */
  name: string;
  /** Empty lets the platform derive it from the name. */
  mimeType: string;
}

/**
 * Android: copies into Download/<subdirectory> (no permission needed).
 * iOS: shows the Save to Files sheet so the user picks the folder. Never rejects.
 */
export const saveToDevice = async (
  file: SaveableFile,
  options: SaveToDeviceOptions = {},
): Promise<SaveToDeviceResult> => {
  try {
    const result = await NativeDocumentKitDownloader.saveToDevice(
      file.uri,
      file.name,
      file.mimeType,
      options.subdirectory ?? '',
      toNativeNotification(options.notification),
    );
    return result.saved
      ? {status: 'saved', location: result.location ?? ''}
      : {status: 'cancelled'};
  } catch (error) {
    return {status: 'failed', error};
  }
};

/** Deletes every cached download, e.g. on logout. */
export const clearDownloadCache = (): Promise<void> =>
  NativeDocumentKitDownloader.clearDownloadCache();
