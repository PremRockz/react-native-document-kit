import type {NativeCropRect, NativePhotoEdits} from '../specs/NativeDocumentKitCamera';

/**
 * Geometry of the review editor's edits, shared by the screens that show them
 * and matching what DocumentKitPhotoEditor applies natively: turn
 * (rotationDegrees), mirror (isFlipped), straighten, then crop (fractions of
 * the result).
 */

export const WHOLE_CROP: NativeCropRect = {x: 0, y: 0, width: 1, height: 1};

export const NO_EDITS: NativePhotoEdits = {
  rotationDegrees: 0,
  isFlipped: false,
  straightenDegrees: 0,
  crop: WHOLE_CROP,
};

/** The straighten ruler's range, each way. */
export const MAX_STRAIGHTEN_DEGREES = 45;

export const isWholeCrop = (rect: NativeCropRect): boolean =>
  rect.x <= 0.001 && rect.y <= 0.001 && rect.x + rect.width >= 0.999 && rect.y + rect.height >= 0.999;

export const isUnedited = (edits: NativePhotoEdits): boolean =>
  edits.rotationDegrees % 360 === 0 &&
  !edits.isFlipped &&
  Math.abs(edits.straightenDegrees) < 0.05 &&
  isWholeCrop(edits.crop);

/** The same region after the photo turns 90° clockwise. */
const rotateCropClockwise = (rect: NativeCropRect): NativeCropRect => ({
  x: 1 - rect.y - rect.height,
  y: rect.x,
  width: rect.height,
  height: rect.width,
});

/** The same region after the photo turns 90° counter-clockwise. */
const rotateCropCounterclockwise = (rect: NativeCropRect): NativeCropRect => ({
  x: rect.y,
  y: 1 - rect.x - rect.width,
  width: rect.height,
  height: rect.width,
});

/** Turns the photo a quarter turn; the crop turns with it. */
export const rotateEdits = (edits: NativePhotoEdits, direction: 'left' | 'right'): NativePhotoEdits => ({
  ...edits,
  rotationDegrees: (edits.rotationDegrees + (direction === 'right' ? 90 : 270)) % 360,
  crop: direction === 'right' ? rotateCropClockwise(edits.crop) : rotateCropCounterclockwise(edits.crop),
});

/** Mirrors the photo; the crop and the straighten angle mirror too, so the picture keeps its framing. */
export const flipEdits = (edits: NativePhotoEdits): NativePhotoEdits => ({
  ...edits,
  isFlipped: !edits.isFlipped,
  straightenDegrees: -edits.straightenDegrees,
  crop: {...edits.crop, x: 1 - edits.crop.x - edits.crop.width},
});

/** The photo's size after the quarter turns. */
export const turnedSize = (
  upright: {width: number; height: number},
  rotationDegrees: number,
): {width: number; height: number} =>
  rotationDegrees % 180 === 0 ? upright : {width: upright.height, height: upright.width};

/** How much a picture turned `degrees` must grow to still cover its own frame. */
export const straightenZoom = (width: number, height: number, degrees: number): number => {
  const angle = (Math.abs(degrees) * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return Math.max((width * cos + height * sin) / width, (width * sin + height * cos) / height);
};

/** The largest frame of `ratio` (width / height, in pixels), centred on a `width`×`height` photo. */
export const fitAspect = (ratio: number, width: number, height: number): NativeCropRect => {
  let frameWidth = width;
  let frameHeight = width / ratio;
  if (frameHeight > height) {
    frameHeight = height;
    frameWidth = height * ratio;
  }
  return {
    x: (1 - frameWidth / width) / 2,
    y: (1 - frameHeight / height) / 2,
    width: frameWidth / width,
    height: frameHeight / height,
  };
};

/** "4:3" → 1.333…; 'free' → null. */
export const parseAspectRatio = (preset: string): number | null => {
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(preset);
  if (!match) {
    return null;
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? width / height : null;
};
