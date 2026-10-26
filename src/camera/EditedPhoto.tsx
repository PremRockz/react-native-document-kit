import React from 'react';
import {Image, View} from 'react-native';
import type {NativePhotoEdits} from '../specs/NativeDocumentKitCamera';
import {WHOLE_CROP, straightenZoom, turnedSize} from './photoEdits';

interface Size {
  width: number;
  height: number;
}

interface EditedPhotoProps {
  /** The screen-sized, upright copy of the photo. */
  uri: string;
  /** Its size (any unit, only the shape counts). */
  upright: Size;
  /** Room to fit into. */
  area: Size;
  edits: NativePhotoEdits;
  /** The editor shows the whole frame with the crop on top; the review shows just the crop. */
  isFullFrame: boolean;
  /** Covers the area, cutting off what spills over (thumbnails), instead of fitting inside it. */
  isFilled?: boolean;
  /** Drawn over the frame, at its size (the crop frame in the editor). */
  renderOverlay?: (frame: Size) => React.ReactNode;
}

/**
 * The photo with the editor's edits, as DocumentKitPhotoEditor writes it:
 * turned, mirrored, straightened (zoomed so no corner is empty), then cropped.
 */
export const EditedPhoto: React.FC<EditedPhotoProps> = ({
  uri,
  upright,
  area,
  edits,
  isFullFrame,
  isFilled = false,
  renderOverlay,
}) => {
  const turned = turnedSize(upright, edits.rotationDegrees);
  const shown = isFullFrame ? WHOLE_CROP : edits.crop;
  const fit = isFilled ? Math.max : Math.min;
  const scale = fit(area.width / (shown.width * turned.width), area.height / (shown.height * turned.height));
  const frame = {width: turned.width * scale, height: turned.height * scale};
  // The upright copy is drawn unturned, then turned in place.
  const drawn = edits.rotationDegrees % 180 === 0 ? frame : {width: frame.height, height: frame.width};
  const zoom = straightenZoom(frame.width, frame.height, edits.straightenDegrees);
  return (
    <View style={{width: shown.width * frame.width, height: shown.height * frame.height, overflow: 'hidden'}}>
      <View
        style={{
          position: 'absolute',
          left: -shown.x * frame.width,
          top: -shown.y * frame.height,
          width: frame.width,
          height: frame.height,
          overflow: 'hidden',
        }}>
        {/* Outermost applies last: straighten, then mirror, then the quarter turns. */}
        <View
          style={{
            position: 'absolute',
            width: frame.width,
            height: frame.height,
            transform: [{rotate: `${edits.straightenDegrees}deg`}, {scale: zoom}],
          }}>
          <View
            style={{
              position: 'absolute',
              width: frame.width,
              height: frame.height,
              transform: [{scaleX: edits.isFlipped ? -1 : 1}],
            }}>
            <Image
              source={{uri}}
              accessibilityIgnoresInvertColors={true}
              style={{
                position: 'absolute',
                left: (frame.width - drawn.width) / 2,
                top: (frame.height - drawn.height) / 2,
                width: drawn.width,
                height: drawn.height,
                transform: [{rotate: `${edits.rotationDegrees}deg`}],
              }}
            />
          </View>
        </View>
        {renderOverlay?.(frame)}
      </View>
    </View>
  );
};
