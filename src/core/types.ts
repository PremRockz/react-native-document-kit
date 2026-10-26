/**
 * Public types shared by every DocumentKit source.
 *
 * Every source (camera, library, files) resolves to the same PickResult so
 * the caller handles one shape no matter where the file came from.
 */

/** Where a file came from. New sources are added here as DocumentKit grows. */
export type FileSource =
  | 'camera_photo'
  | 'camera_video'
  | 'library'
  | 'documents';

export interface PickedFile {
  /** Always a file:// URI. */
  uri: string;
  /** Full file name including the extension, e.g. "Image_1700000000000.jpg". */
  name: string;
  /** File name without the extension. */
  baseName: string;
  /** Lowercase extension without the dot, e.g. "jpg". */
  extension: string;
  mimeType: string;
  /** Size in bytes. 0 when the size could not be read. */
  size: number;
  width?: number;
  height?: number;
  /** Videos only. */
  durationMs?: number;
  source: FileSource;
}

export type UnavailableReason = 'no_camera_device';

export type PickErrorCode =
  /** Another pick is already in progress. */
  | 'busy'
  | 'permission_check_failed'
  | 'capture_failed'
  | 'pick_failed';

export type PickResult =
  | {status: 'picked'; files: PickedFile[]}
  | {status: 'cancelled'}
  /** isBlocked: the OS will not show the prompt again; only Settings can grant it. */
  | {status: 'permission_denied'; isBlocked: boolean}
  | {status: 'unavailable'; reason: UnavailableReason}
  | {status: 'error'; code: PickErrorCode};

export type DocumentKitOperation =
  | 'camera_permission'
  | 'camera_prewarm'
  | 'camera_capture'
  | 'system_camera_capture'
  | 'library_pick'
  | 'document_pick'
  | 'microphone_permission'
  | 'network_read'
  | 'video_recording'
  /** The app's onUnauthorized threw while refreshing the session. */
  | 'session_refresh'
  /** The review screen's crop or rotation could not be saved. */
  | 'photo_edit';

/**
 * Receives errors DocumentKit handled internally, so the host app can send them
 * to its own monitoring. DocumentKit never shows raw errors to the user.
 */
export type DocumentKitErrorReporter = (
  error: unknown,
  context: {operation: DocumentKitOperation},
) => void;
