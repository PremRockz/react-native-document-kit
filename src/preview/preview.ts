import {processColor} from 'react-native';
import type {ColorValue} from 'react-native';
import {mimeTypeForName} from '../core/fileUtils';
import {mergeHeaders, refreshHeaders} from '../core/unauthorized';
import type {UnauthorizedHandler} from '../core/unauthorized';
import {DEFAULT_NOTIFICATION_LABELS, downloadFile} from '../download/download';
import type {DownloadNotification, DownloadProgress} from '../download/download';
import NativeDocumentKitPreview from '../specs/NativeDocumentKitPreview';
import type {
  NativePlayerOptions,
  NativePreviewSave,
} from '../specs/NativeDocumentKitPreview';

export interface PreviewSource {
  /** https:// (remote) or file:// / content:// (local). */
  uri: string;
  /** Shown as the viewer's title; its extension picks the viewer when mimeType is missing. */
  name: string;
  mimeType?: string;
  /** Sent with remote requests, e.g. the session cookie. */
  headers?: Record<string, string>;
  /**
   * Cache key for remote documents, which are downloaded silently before they
   * show (video and audio stream instead). Same key as downloadFile, so a file
   * previewed once is also ready for "Download", and the other way round.
   */
  cacheKey?: string;
  /** Downloads the document again even if it is cached. Defaults to false. */
  forceRefresh?: boolean;
}

export interface PreviewLabels {
  /** Accessibility label of the close button. */
  close: string;
  /** Shown when a video or audio stream cannot play. */
  playbackError: string;
  /** Accessibility label of the Save button (Android viewers). */
  save: string;
  /** Message after saving to Downloads. */
  saved: string;
  /** Message when saving fails. */
  saveFailed: string;
  /** Shown above a text or HTML file that is too large to show in full (Android). */
  truncated: string;
  /** Accessibility labels of the video/audio player's buttons. */
  mute: string;
  unmute: string;
  play: string;
  pause: string;
  seekBack: string;
  seekForward: string;
  playbackSpeed: string;
  fullScreen: string;
  exitFullScreen: string;
}

/** DocumentKit's video/audio player; everything is on by default. */
export interface PlayerOptions {
  /** Defaults to true; false opens paused, with the controls showing. */
  autoPlay?: boolean;
  /** Defaults to 5; 0 hides the back button. */
  skipBackSeconds?: number;
  /** Defaults to 15; 0 hides the forward button. */
  skipForwardSeconds?: number;
  /** The playback speed button (0.5× to 2×). Defaults to true. */
  allowSpeed?: boolean;
  /** The full-screen button. Defaults to true. */
  allowFullScreen?: boolean;
}

/**
 * Adds a Save button to Android's image and PDF viewers, saving to
 * Download/<subdirectory> without leaving the viewer. iOS QuickLook offers
 * Save to Files from its own share button, so this is ignored there.
 */
export interface PreviewSaveOptions {
  subdirectory: string;
  /** "Downloaded" notification after saving; only tag/title/channelName/downloaded/close are used. */
  notification?: DownloadNotification;
}

export interface PreviewOptions {
  labels?: Partial<PreviewLabels>;
  /** Video and audio start without sound; the player's sound button turns it on. */
  muted?: boolean;
  /** The player's seek bar colour. Defaults to DocumentKit's blue. */
  accentColor?: ColorValue;
  /** Video and audio: which controls the player has. */
  player?: PlayerOptions;
  /**
   * On 401/403 (a document download or a video stream): return fresh headers to
   * retry once. Defaults to the provider's onUnauthorized.
   */
  onUnauthorized?: UnauthorizedHandler;
  /** Progress of the silent download that documents need before they show. */
  onProgress?: (progress: DownloadProgress) => void;
  signal?: AbortSignal;
  save?: PreviewSaveOptions;
  /**
   * Runs right before the native viewer opens, e.g. to close a loading
   * overlay first (iOS cannot present a viewer while another screen is closing).
   */
  beforePresent?: () => Promise<void>;
}

export type PreviewResult =
  /** Shown in the app and dismissed. */
  | {status: 'closed'}
  /** Android only: handed to another app because there is no in-app viewer (e.g. Office). */
  | {status: 'opened_externally'}
  /** Nothing on the device can open this type. */
  | {status: 'unsupported'}
  | {status: 'cancelled'}
  /** Another DocumentKit screen (camera, picker, preview) is already open. */
  | {status: 'busy'}
  | {
      status: 'failed';
      /**
       * 'unauthorized': the server answered 401 or 403 and a session refresh
       * (onUnauthorized), if any, did not help. Usually: ask the user to sign in.
       */
      reason: 'download' | 'viewer' | 'unauthorized';
      /** The server's status, for 'unauthorized' and HTTP download failures. */
      httpStatus?: number;
      /** For the host app's monitoring; never show it to the user. */
      error: unknown;
    };

const DEFAULT_LABELS: PreviewLabels = {
  close: 'Close',
  playbackError: 'This file cannot be played.',
  save: 'Save',
  saved: 'Saved to Downloads',
  saveFailed: 'Could not save the file',
  truncated: 'This file is large, so only its beginning is shown.',
  mute: 'Mute',
  unmute: 'Unmute',
  play: 'Play',
  pause: 'Pause',
  seekBack: 'Back {seconds} seconds',
  seekForward: 'Forward {seconds} seconds',
  playbackSpeed: 'Playback speed',
  fullScreen: 'Full screen',
  exitFullScreen: 'Exit full screen',
};

const DEFAULT_SKIP_BACK_SECONDS = 5;
const DEFAULT_SKIP_FORWARD_SECONDS = 15;

/** A colour as the native player reads it; 0 (also for platform colours) keeps its default. */
const toNativeColor = (color: ColorValue | undefined): number => {
  const processed = color === undefined ? null : processColor(color);
  return typeof processed === 'number' ? processed : 0;
};

/** Options for DocumentKit's native player, shared with the camera's recording review. */
export const toPlayerOptions = (options: {
  muted?: boolean;
  accentColor?: ColorValue;
  mimeType?: string;
  save?: PreviewSaveOptions;
  startPositionMs?: number;
  player?: PlayerOptions;
}): NativePlayerOptions => ({
  muted: options.muted ?? false,
  accentColor: toNativeColor(options.accentColor),
  mimeType: options.mimeType ?? '',
  save: toNativeSave(options.save),
  startPositionMs: options.startPositionMs ?? 0,
  autoPlay: options.player?.autoPlay ?? true,
  skipBackSeconds: Math.max(0, options.player?.skipBackSeconds ?? DEFAULT_SKIP_BACK_SECONDS),
  skipForwardSeconds: Math.max(0, options.player?.skipForwardSeconds ?? DEFAULT_SKIP_FORWARD_SECONDS),
  allowSpeed: options.player?.allowSpeed ?? true,
  allowFullScreen: options.player?.allowFullScreen ?? true,
});

const toNativeSave = (save: PreviewSaveOptions | undefined): NativePreviewSave | null =>
  save
    ? {
        subdirectory: save.subdirectory,
        notification: save.notification
          ? {
              tag: save.notification.tag,
              title: save.notification.title,
              channelName: save.notification.channelName ?? DEFAULT_NOTIFICATION_LABELS.channelName,
              completedText: save.notification.downloaded ?? DEFAULT_NOTIFICATION_LABELS.downloaded,
              closeLabel: save.notification.close ?? DEFAULT_NOTIFICATION_LABELS.close,
            }
          : null,
      }
    : null;

const isStreamable = (mimeType: string): boolean =>
  mimeType.startsWith('video/') || mimeType.startsWith('audio/');

const isLocalUri = (uri: string): boolean =>
  uri.startsWith('file://') || uri.startsWith('content://');

const toPreviewResult = (outcome: string): PreviewResult => {
  switch (outcome) {
    case 'opened_externally':
      return {status: 'opened_externally'};
    case 'unsupported':
      return {status: 'unsupported'};
    default:
      return {status: 'closed'};
  }
};

/**
 * Streams video or audio in DocumentKit's player. When the server answers
 * 401/403, the player closes itself; with fresh headers from onUnauthorized it
 * reopens once where it stopped, otherwise the result is 'unauthorized'.
 */
const playStream = async (
  source: PreviewSource,
  mimeType: string,
  headers: Record<string, string>,
  labels: PreviewLabels,
  options: PreviewOptions,
): Promise<PreviewResult> => {
  let playHeaders = headers;
  let startPositionMs = 0;
  for (let attempt = 1; ; attempt++) {
    const played = await NativeDocumentKitPreview.playMedia(
      source.uri,
      playHeaders,
      source.name,
      labels,
      toPlayerOptions({
        muted: options.muted,
        accentColor: options.accentColor,
        mimeType,
        save: options.save,
        startPositionMs,
        player: options.player,
      }),
    );
    if (played.outcome !== 'unauthorized') {
      return toPreviewResult(played.outcome);
    }
    const fresh = attempt === 1 ? await refreshHeaders(source.uri, played.httpStatus, options.onUnauthorized) : null;
    if (!fresh) {
      return {
        status: 'failed',
        reason: 'unauthorized',
        httpStatus: played.httpStatus,
        error: new Error(`The server answered ${played.httpStatus} to the media stream`),
      };
    }
    playHeaders = mergeHeaders(playHeaders, fresh);
    startPositionMs = played.positionMs;
  }
};

/**
 * Opens a file in a full-screen, in-app viewer:
 * - video/audio: native player, streamed (no download)
 * - PDF, images, plain text, CSV, HTML: QuickLook on iOS; DocumentKit's own viewers on Android
 * - Office, iWork: QuickLook on iOS; "Open with" on Android
 * Remote documents are downloaded into DocumentKit's private cache first, never
 * into the user's files. Resolves when the viewer closes. Never rejects.
 */
export const openPreview = async (
  source: PreviewSource,
  options: PreviewOptions = {},
): Promise<PreviewResult> => {
  const labels: PreviewLabels = {...DEFAULT_LABELS, ...options.labels};
  const mimeType = source.mimeType || mimeTypeForName(source.name);
  const headers = source.headers ?? {};

  try {
    if (isStreamable(mimeType)) {
      await options.beforePresent?.();
      return await playStream(source, mimeType, headers, labels, options);
    }

    let fileUri = source.uri;
    if (!isLocalUri(source.uri)) {
      const download = await downloadFile({
        url: source.uri,
        fileName: source.name,
        cacheKey: source.cacheKey,
        forceRefresh: source.forceRefresh,
        headers,
        onUnauthorized: options.onUnauthorized,
        onProgress: options.onProgress,
        signal: options.signal,
      });
      if (download.status === 'cancelled') {
        return {status: 'cancelled'};
      }
      if (download.status === 'failed') {
        return {
          status: 'failed',
          reason: download.reason === 'unauthorized' ? 'unauthorized' : 'download',
          httpStatus: download.httpStatus,
          error: download.error,
        };
      }
      fileUri = download.file.uri;
    }

    await options.beforePresent?.();
    if (options.signal?.aborted) {
      return {status: 'cancelled'};
    }
    return toPreviewResult(
      await NativeDocumentKitPreview.presentFile(
        fileUri,
        source.name,
        mimeType,
        labels,
        toNativeSave(options.save),
      ),
    );
  } catch (error) {
    return {status: 'failed', reason: 'viewer', error};
  }
};
