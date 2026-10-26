import type {CodegenTypes, TurboModule} from 'react-native';
import {TurboModuleRegistry} from 'react-native';

export type NativePreviewLabels = {
  /** Accessibility label of the close button. */
  close: string;
  /** Shown when a video or audio stream cannot play. */
  playbackError: string;
  /** Accessibility label of the Save button (Android viewers). */
  save: string;
  /** Toast after saving to Downloads. */
  saved: string;
  /** Toast when saving fails. */
  saveFailed: string;
  /** Shown above a text file that is too large to show in full. */
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
};

/** Android "Downloaded" notification after saving from a viewer. */
export type NativePreviewSaveNotification = {
  tag: string;
  title: string;
  channelName: string;
  completedText: string;
  closeLabel: string;
};

/** Adds a Save button to Android's image and PDF viewers; iOS QuickLook has its own share/save. */
export type NativePreviewSave = {
  /** Folder under Download/, e.g. "MyApp/acme". */
  subdirectory: string;
  notification: NativePreviewSaveNotification | null;
};

/** How DocumentKit's video/audio player looks and what it offers. */
export type NativePlayerOptions = {
  /** Starts without sound; the player's sound button turns it back on. */
  muted: boolean;
  /** Seek bar colour as processColor gives it (ARGB); 0 keeps the default. */
  accentColor: CodegenTypes.Double;
  /** Of the saved file; empty lets the platform derive it from the title. */
  mimeType: string;
  /** Adds a Download button (streamed media is downloaded first); null hides it. */
  save: NativePreviewSave | null;
  /** Where playback starts, e.g. when reopened with fresh headers after a 401. */
  startPositionMs: CodegenTypes.Double;
  /** False opens paused, with the controls showing. */
  autoPlay: boolean;
  /** The back / forward buttons' jump; 0 hides that button. */
  skipBackSeconds: CodegenTypes.Double;
  skipForwardSeconds: CodegenTypes.Double;
  /** The playback speed button. */
  allowSpeed: boolean;
  /** The full-screen button. */
  allowFullScreen: boolean;
};

/** How the player closed. */
export type NativePlayerOutcome = {
  /**
   * "closed", or "unauthorized" when the server answered 401 or 403: the player
   * then closes itself so the caller can refresh the session and reopen it.
   */
  outcome: string;
  /** Playback position when it closed, to resume from. */
  positionMs: CodegenTypes.Double;
  /** The server's status for "unauthorized"; 0 otherwise. */
  httpStatus: CodegenTypes.Int32;
};

/**
 * Full-screen, in-app preview screens.
 *
 * Resolved outcomes (codegen cannot type string unions, so JS narrows them):
 * - "closed"             shown in the app and dismissed by the user
 * - "opened_externally"  Android only: handed to another app ("Open with")
 * - "unsupported"        nothing on the device can open this file type
 *
 * Rejection codes: E_BUSY, E_NO_ACTIVITY, E_VIEWER (file could not be rendered).
 */
export interface Spec extends TurboModule {
  /**
   * Local file (file://, or content:// on Android).
   * iOS: QuickLook (PDF, Office, iWork, images, text).
   * Android: DocumentKit's viewers for PDFs, images, plain text, CSV and HTML; "Open with" for anything else.
   */
  presentFile(
    fileUri: string,
    title: string,
    mimeType: string,
    labels: NativePreviewLabels,
    save: NativePreviewSave | null,
  ): Promise<string>;
  /**
   * Streams video or audio without downloading it first (local URIs work too).
   * iOS sends only the Cookie header (as cookies); Android sends every header.
   */
  playMedia(
    url: string,
    headers: CodegenTypes.UnsafeObject,
    title: string,
    labels: NativePreviewLabels,
    options: NativePlayerOptions,
  ): Promise<NativePlayerOutcome>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('DocumentKitPreview');
