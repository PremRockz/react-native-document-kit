import type {TurboModule} from 'react-native';
import {TurboModuleRegistry} from 'react-native';

/** A file the native side has already copied into the app's cache. */
export type NativePickedFile = {
  /** file:// URI inside the app cache. */
  uri: string;
  name: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  durationMs?: number;
};

export type NativePickResponse = {
  cancelled: boolean;
  files: NativePickedFile[];
};

/**
 * OS camera, system photo library and system file picker.
 *
 * String arguments (codegen cannot type string unions, so JS validates them):
 * - mediaType: "photo" | "video" | "mixed" ("mixed" is library only)
 * - videoQuality: "low" | "medium" | "high"
 *
 * Rejection codes: E_BUSY, E_UNAVAILABLE (no camera), E_NO_ACTIVITY,
 * E_CAPTURE_FAILED, E_PICK_FAILED.
 */
export interface Spec extends TurboModule {
  captureWithSystemCamera(
    mediaType: string,
    videoQuality: string,
    maxDurationSeconds: number,
  ): Promise<NativePickResponse>;
  /** selectionLimit 0 means no limit. */
  pickFromLibrary(
    mediaType: string,
    selectionLimit: number,
  ): Promise<NativePickResponse>;
  /**
   * Files app (iOS) / system file picker (Android). mimeTypes may use
   * wildcards ("image/*"); an empty list allows every file type.
   */
  pickDocuments(
    mimeTypes: string[],
    allowMultiple: boolean,
  ): Promise<NativePickResponse>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('DocumentKitMediaPicker');
