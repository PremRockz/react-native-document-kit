import type {CodegenTypes, TurboModule} from 'react-native';
import {TurboModuleRegistry} from 'react-native';

export type NativeDownloadProgress = {
  downloadId: string;
  bytesWritten: number;
  /** -1 when the server does not send a length. */
  totalBytes: number;
};

export type NativeDownloadedFile = {
  /** file:// URI of the cached copy. */
  uri: string;
  name: string;
  mimeType: string;
  size: number;
  fromCache: boolean;
};

/** Android only; iOS ignores it. */
export type NativeDownloadNotification = {
  /** Same tag for download and save, so "Downloaded" replaces the progress notification. */
  tag: string;
  /** Usually the file name. */
  title: string;
  /** Name of the "Downloads" channel in Android's notification settings. */
  channelName: string;
  downloadingText: string;
  completedText: string;
  /** Accessibility label of the close button in the PDF viewer opened from the notification. */
  closeLabel: string;
};

export type NativeSaveResult = {
  saved: boolean;
  /** content:// (Android Downloads) or file:// (iOS, where the user saved it). */
  location?: string;
};

/**
 * Downloads into a shared cache (Caches/document-kit/downloads), keyed by cacheKey,
 * and saves cached files to the device.
 *
 * Rejection codes: E_CANCELLED, E_HTTP (userInfo.status), E_NETWORK,
 * E_STORAGE, E_BUSY, E_NO_ACTIVITY.
 */
export interface Spec extends TurboModule {
  readonly onDownloadProgress: CodegenTypes.EventEmitter<NativeDownloadProgress>;
  /** Resolves from cache without a request when cacheKey was downloaded before. */
  download(
    downloadId: string,
    url: string,
    headers: CodegenTypes.UnsafeObject,
    cacheKey: string,
    fileName: string,
    /** null: no notification. Shows download progress; removed on failure or cancel. */
    notification: NativeDownloadNotification | null,
    /** Ignores (and drops) the cached copy and any partial download, and fetches the file again. */
    forceRefresh: boolean,
  ): Promise<NativeDownloadedFile>;
  /** Stops the transfer; the partial file is kept so the next attempt resumes. */
  cancelDownload(downloadId: string): void;
  /**
   * Android: copies into Download/<subdirectory> via MediaStore (no permission).
   * iOS: shows the Save to Files sheet; subdirectory is ignored.
   */
  saveToDevice(
    fileUri: string,
    fileName: string,
    mimeType: string,
    subdirectory: string,
    /** null: no notification. Shows "Downloaded"; tapping opens the saved file. */
    notification: NativeDownloadNotification | null,
  ): Promise<NativeSaveResult>;
  clearDownloadCache(): Promise<void>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('DocumentKitDownloader');
