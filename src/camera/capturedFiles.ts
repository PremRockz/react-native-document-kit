import {getExtension} from '../core/fileUtils';
import type {FileSource, PickedFile} from '../core/types';
import type {
  NativeCapturedPhoto,
  NativeCapturedVideo,
} from '../specs/NativeDocumentKitCamera';

/**
 * Converts a photo or recording from DocumentKit's camera into the PickedFile
 * shape. The native side already read its size, displayed dimensions and
 * duration, so nothing is read here.
 */
export const buildCapturedFile = (
  file: NativeCapturedPhoto | NativeCapturedVideo,
  source: FileSource,
): PickedFile => {
  const extension = getExtension(file.name) || (source === 'camera_video' ? 'mp4' : 'jpg');
  return {
    uri: file.uri,
    name: file.name,
    baseName: file.name.endsWith(`.${extension}`)
      ? file.name.slice(0, -(extension.length + 1))
      : file.name,
    extension,
    mimeType: file.mimeType,
    size: file.size,
    width: file.width,
    height: file.height,
    durationMs: 'durationMs' in file ? file.durationMs : undefined,
    source,
  };
};
