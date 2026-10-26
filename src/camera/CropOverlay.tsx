import React, {useEffect, useRef, useState} from 'react';
import {PanResponder, View} from 'react-native';
import type {NativeCropRect} from '../specs/NativeDocumentKitCamera';
import {cropStyles, useThemeStyles} from './styles';
import type {DocumentKitCameraTheme} from './types';

interface CropOverlayProps {
  /** The photo's size on screen; the overlay covers exactly that. */
  width: number;
  height: number;
  /** Fractions (0–1) of the photo as shown. */
  rect: NativeCropRect;
  /** Width / height the frame keeps while resized; null resizes freely. */
  aspectRatio: number | null;
  /** False shows the frame without letting it be dragged (other editor tabs). */
  isInteractive: boolean;
  theme: DocumentKitCameraTheme;
  onChange: (rect: NativeCropRect) => void;
}

type Corner = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';
type Edge = 'top' | 'bottom' | 'left' | 'right';
type DragMode = 'move' | Corner | Edge;

// How close to a corner a touch must start to resize from it.
const CORNER_HIT_PX = 36;
// How close to an edge line a touch must start to move just that side.
const EDGE_HIT_PX = 24;
// The frame never gets smaller than this, so it stays easy to grab.
const MIN_SIZE_PX = 64;
const HANDLE_SIZE = 14;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const isLeftCorner = (corner: Corner) => corner === 'topLeft' || corner === 'bottomLeft';
const isTopCorner = (corner: Corner) => corner === 'topLeft' || corner === 'topRight';

const moveFrame = (start: NativeCropRect, dx: number, dy: number): NativeCropRect => ({
  ...start,
  x: clamp(start.x + dx, 0, 1 - start.width),
  y: clamp(start.y + dy, 0, 1 - start.height),
});

/** Free resize: the dragged corner follows the finger, the opposite one stays. */
const resizeFree = (
  corner: Corner,
  start: NativeCropRect,
  dx: number,
  dy: number,
  minWidth: number,
  minHeight: number,
): NativeCropRect => {
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;
  if (isLeftCorner(corner)) {
    left = clamp(left + dx, 0, right - minWidth);
  } else {
    right = clamp(right + dx, left + minWidth, 1);
  }
  if (isTopCorner(corner)) {
    top = clamp(top + dy, 0, bottom - minHeight);
  } else {
    bottom = clamp(bottom + dy, top + minHeight, 1);
  }
  return {x: left, y: top, width: right - left, height: bottom - top};
};

/** Resize keeping `ratio`: the largest frame of that shape inside what the drag asks for. */
const resizeLocked = (
  corner: Corner,
  start: NativeCropRect,
  dx: number,
  dy: number,
  ratio: number,
  boxWidth: number,
  boxHeight: number,
): NativeCropRect => {
  const movesLeft = isLeftCorner(corner);
  const movesTop = isTopCorner(corner);
  // The opposite corner stays put.
  const anchorX = movesLeft ? start.x + start.width : start.x;
  const anchorY = movesTop ? start.y + start.height : start.y;
  const cornerX = (movesLeft ? start.x : start.x + start.width) + dx;
  const cornerY = (movesTop ? start.y : start.y + start.height) + dy;
  let width = Math.max(Math.abs(anchorX - cornerX) * boxWidth, 1);
  let height = Math.max(Math.abs(anchorY - cornerY) * boxHeight, 1);
  if (width / height > ratio) {
    width = height * ratio;
  } else {
    height = width / ratio;
  }
  // No smaller than the minimum, no larger than the room toward the dragged corner.
  const grow = Math.max(1, MIN_SIZE_PX / width, MIN_SIZE_PX / height);
  width *= grow;
  height *= grow;
  const roomWidth = (movesLeft ? anchorX : 1 - anchorX) * boxWidth;
  const roomHeight = (movesTop ? anchorY : 1 - anchorY) * boxHeight;
  const shrink = Math.min(1, roomWidth / width, roomHeight / height);
  width *= shrink;
  height *= shrink;
  const widthFraction = width / boxWidth;
  const heightFraction = height / boxHeight;
  return {
    x: movesLeft ? anchorX - widthFraction : anchorX,
    y: movesTop ? anchorY - heightFraction : anchorY,
    width: widthFraction,
    height: heightFraction,
  };
};

const isEdge = (mode: DragMode): mode is Edge =>
  mode === 'top' || mode === 'bottom' || mode === 'left' || mode === 'right';

/** Free resize from one side: that side follows the finger, the others stay. */
const resizeEdgeFree = (
  edge: Edge,
  start: NativeCropRect,
  dx: number,
  dy: number,
  minWidth: number,
  minHeight: number,
): NativeCropRect => {
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;
  if (edge === 'left') {
    left = clamp(left + dx, 0, right - minWidth);
  } else if (edge === 'right') {
    right = clamp(right + dx, left + minWidth, 1);
  } else if (edge === 'top') {
    top = clamp(top + dy, 0, bottom - minHeight);
  } else {
    bottom = clamp(bottom + dy, top + minHeight, 1);
  }
  return {x: left, y: top, width: right - left, height: bottom - top};
};

/**
 * Resize from one side keeping `ratio`: the opposite side stays, and the other
 * dimension grows or shrinks around the frame's centre line.
 */
const resizeEdgeLocked = (
  edge: Edge,
  start: NativeCropRect,
  dx: number,
  dy: number,
  ratio: number,
  boxWidth: number,
  boxHeight: number,
): NativeCropRect => {
  const isHorizontal = edge === 'left' || edge === 'right';
  // In pixels, along the dragged axis ("main") and across it ("cross").
  const startMain = isHorizontal ? start.width * boxWidth : start.height * boxHeight;
  const delta = {left: -dx * boxWidth, right: dx * boxWidth, top: -dy * boxHeight, bottom: dy * boxHeight}[edge];
  const mainBox = isHorizontal ? boxWidth : boxHeight;
  const crossBox = isHorizontal ? boxHeight : boxWidth;
  // The cross dimension per pixel of the main one.
  const crossPerMain = isHorizontal ? 1 / ratio : ratio;
  const anchor = {left: start.x + start.width, right: start.x, top: start.y + start.height, bottom: start.y}[edge];
  const crossCenter = isHorizontal ? start.y + start.height / 2 : start.x + start.width / 2;
  // Room: toward the dragged side, and on both sides of the centre line across.
  const roomMain = (edge === 'left' || edge === 'top' ? anchor : 1 - anchor) * mainBox;
  const roomCross = 2 * Math.min(crossCenter, 1 - crossCenter) * crossBox;
  const minMain = Math.max(MIN_SIZE_PX, MIN_SIZE_PX / crossPerMain);
  const maxMain = Math.min(roomMain, roomCross / crossPerMain);
  const main = clamp(startMain + delta, Math.min(minMain, maxMain), maxMain);
  const mainFraction = main / mainBox;
  const crossFraction = (main * crossPerMain) / crossBox;
  const mainStart = edge === 'left' || edge === 'top' ? anchor - mainFraction : anchor;
  const crossStart = crossCenter - crossFraction / 2;
  return isHorizontal
    ? {x: mainStart, y: crossStart, width: mainFraction, height: crossFraction}
    : {x: crossStart, y: mainStart, width: crossFraction, height: mainFraction};
};

/** What a touch at (x, y) grabs: a corner, an edge line, the inside (to move), or nothing. */
const hitTest = (x: number, y: number, rect: NativeCropRect, boxWidth: number, boxHeight: number): DragMode | null => {
  const left = rect.x * boxWidth;
  const top = rect.y * boxHeight;
  const right = left + rect.width * boxWidth;
  const bottom = top + rect.height * boxHeight;
  const near = (cornerX: number, cornerY: number) =>
    Math.abs(x - cornerX) <= CORNER_HIT_PX && Math.abs(y - cornerY) <= CORNER_HIT_PX;
  if (near(left, top)) {
    return 'topLeft';
  }
  if (near(right, top)) {
    return 'topRight';
  }
  if (near(left, bottom)) {
    return 'bottomLeft';
  }
  if (near(right, bottom)) {
    return 'bottomRight';
  }
  const isBetweenSides = x > left && x < right;
  const isBetweenEnds = y > top && y < bottom;
  if (isBetweenSides && Math.abs(y - top) <= EDGE_HIT_PX) {
    return 'top';
  }
  if (isBetweenSides && Math.abs(y - bottom) <= EDGE_HIT_PX) {
    return 'bottom';
  }
  if (isBetweenEnds && Math.abs(x - left) <= EDGE_HIT_PX) {
    return 'left';
  }
  if (isBetweenEnds && Math.abs(x - right) <= EDGE_HIT_PX) {
    return 'right';
  }
  return isBetweenSides && isBetweenEnds ? 'move' : null;
};

/**
 * A crop frame over the photo: drag a corner or an edge line to resize
 * (keeping aspectRatio when set), inside to move. The rest of the photo is shaded, with a
 * rule-of-thirds grid inside the frame.
 */
export const CropOverlay: React.FC<CropOverlayProps> = ({
  width,
  height,
  rect,
  aspectRatio,
  isInteractive,
  theme,
  onChange,
}) => {
  const themed = useThemeStyles(theme);
  // The responder is created once; it reads the latest values through these.
  const latest = useRef({rect, width, height, aspectRatio, onChange});
  useEffect(() => {
    latest.current = {rect, width, height, aspectRatio, onChange};
  });
  const drag = useRef<{mode: DragMode; start: NativeCropRect} | null>(null);

  const [responder] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: event => {
        const {rect: current, width: boxWidth, height: boxHeight} = latest.current;
        const {locationX, locationY} = event.nativeEvent;
        const mode = hitTest(locationX, locationY, current, boxWidth, boxHeight);
        drag.current = mode ? {mode, start: current} : null;
      },
      onPanResponderMove: (_, gesture) => {
        const {width: boxWidth, height: boxHeight, aspectRatio: ratio, onChange: change} = latest.current;
        if (!drag.current || boxWidth <= 0 || boxHeight <= 0) {
          return;
        }
        const {mode, start} = drag.current;
        const dx = gesture.dx / boxWidth;
        const dy = gesture.dy / boxHeight;
        const minWidth = Math.min(MIN_SIZE_PX / boxWidth, 1);
        const minHeight = Math.min(MIN_SIZE_PX / boxHeight, 1);
        if (mode === 'move') {
          change(moveFrame(start, dx, dy));
        } else if (isEdge(mode)) {
          change(
            ratio
              ? resizeEdgeLocked(mode, start, dx, dy, ratio, boxWidth, boxHeight)
              : resizeEdgeFree(mode, start, dx, dy, minWidth, minHeight),
          );
        } else {
          change(
            ratio
              ? resizeLocked(mode, start, dx, dy, ratio, boxWidth, boxHeight)
              : resizeFree(mode, start, dx, dy, minWidth, minHeight),
          );
        }
      },
      onPanResponderRelease: () => {
        drag.current = null;
      },
      onPanResponderTerminate: () => {
        drag.current = null;
      },
    }),
  );

  const left = rect.x * width;
  const top = rect.y * height;
  const frameWidth = rect.width * width;
  const frameHeight = rect.height * height;
  const shade = [cropStyles.shade, themed.overlay];
  const handle = [cropStyles.handle, themed.primaryBorder];
  const handleOffset = HANDLE_SIZE / 2;

  return (
    // Children take no touches, so locationX/Y are always relative to this view.
    <View
      style={{position: 'absolute', left: 0, top: 0, width, height}}
      pointerEvents={isInteractive ? 'auto' : 'none'}
      {...responder.panHandlers}>
      <View pointerEvents="none" style={[shade, {left: 0, top: 0, width, height: top}]} />
      <View pointerEvents="none" style={[shade, {left: 0, top: top + frameHeight, width, bottom: 0}]} />
      <View pointerEvents="none" style={[shade, {left: 0, top, width: left, height: frameHeight}]} />
      <View pointerEvents="none" style={[shade, {left: left + frameWidth, top, right: 0, height: frameHeight}]} />
      <View
        pointerEvents="none"
        style={[cropStyles.frame, themed.iconBorder, {left, top, width: frameWidth, height: frameHeight}]}>
        {[1, 2].map(third => (
          <React.Fragment key={third}>
            <View style={[cropStyles.gridLine, {left: (frameWidth * third) / 3, top: 0, bottom: 0, width: 1}]} />
            <View style={[cropStyles.gridLine, {top: (frameHeight * third) / 3, left: 0, right: 0, height: 1}]} />
          </React.Fragment>
        ))}
      </View>
      {[
        [left, top],
        [left + frameWidth, top],
        [left, top + frameHeight],
        [left + frameWidth, top + frameHeight],
      ].map(([x, y]) => (
        <View
          key={`${x === left ? 'left' : 'right'}-${y === top ? 'top' : 'bottom'}`}
          pointerEvents="none"
          style={[handle, {left: x - handleOffset, top: y - handleOffset}]}
        />
      ))}
    </View>
  );
};
