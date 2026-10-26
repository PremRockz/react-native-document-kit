const FILE_SCHEME = 'file://';

const MIME_TYPE_BY_EXTENSION: Record<string, string> = {
  // Images
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  svg: 'image/svg+xml',
  heic: 'image/heic',
  heif: 'image/heif',
  // Documents
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  rtf: 'application/rtf',
  txt: 'text/plain',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  html: 'text/html',
  htm: 'text/html',
  // Video
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  mov: 'video/quicktime',
  '3gp': 'video/3gpp',
  '3gpp': 'video/3gpp',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  wmv: 'video/x-ms-wmv',
  mpg: 'video/mpeg',
  mpeg: 'video/mpeg',
  ogv: 'video/ogg',
  // Audio
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
};

export const mimeTypeForName = (fileName: string): string =>
  getMimeType(getExtension(fileName), 'application/octet-stream');

export const toFileUri = (path: string): string =>
  path.startsWith(FILE_SCHEME) ? path : `${FILE_SCHEME}${path}`;

export const toFilePath = (uri: string): string =>
  uri.startsWith(FILE_SCHEME) ? uri.slice(FILE_SCHEME.length) : uri;

/** Lowercase extension without the dot, or '' when the path has none. */
export const getExtension = (path: string): string => {
  const fileName = path.slice(path.lastIndexOf('/') + 1);
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex > 0 ? fileName.slice(dotIndex + 1).toLowerCase() : '';
};

export const getMimeType = (extension: string, fallback: string): string =>
  MIME_TYPE_BY_EXTENSION[extension] ?? fallback;
