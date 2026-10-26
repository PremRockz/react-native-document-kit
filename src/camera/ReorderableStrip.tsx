import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {Animated, PanResponder, ScrollView, StyleSheet, View} from 'react-native';
import type {LayoutChangeEvent, StyleProp, ViewStyle} from 'react-native';

/** What each tile gets to start a drag (long press) and to end one that never moved. */
export interface ReorderHandle {
  isDragging: boolean;
  startDrag: () => void;
  endDragIfIdle: () => void;
}

interface ReorderableStripProps<T> {
  items: T[];
  keyOf: (item: T) => string;
  isReorderEnabled: boolean;
  contentContainerStyle: StyleProp<ViewStyle>;
  renderItem: (item: T, index: number, handle: ReorderHandle) => React.ReactNode;
  /** After the tiles, never moved: the "+" tile. */
  footer?: React.ReactNode;
  onReorder: (key: string, toIndex: number) => void;
}

interface Drag {
  key: string;
  fromIndex: number;
  /** Distance between the starts of two neighbouring tiles. */
  pitch: number;
}

// Closer than this to an edge of the strip, it scrolls by itself while dragging.
const AUTO_SCROLL_EDGE = 48;
const AUTO_SCROLL_STEP = 8;
const SETTLE_MS = 150;
const LIFTED_SCALE = 1.08;

// What the gesture callbacks read: they are made once, so they cannot use state.
interface LiveDrag {
  drag: Drag | null;
  targetIndex: number;
  isPanActive: boolean;
  gestureDx: number;
  pointerX: number;
  stripPageX: number;
  stripWidth: number;
  contentWidth: number;
  scrollX: number;
  scrollXAtStart: number;
  frame: number | null;
  hasPendingReset: boolean;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const shiftOf = (shifts: Map<string, Animated.Value>, key: string): Animated.Value => {
  let shift = shifts.get(key);
  if (!shift) {
    shift = new Animated.Value(0);
    shifts.set(key, shift);
  }
  return shift;
};

/** How far a tile slides aside so the dragged one fits at targetIndex. */
const shiftFor = (index: number, drag: Drag, targetIndex: number): number => {
  if (drag.fromIndex < index && index <= targetIndex) {
    return -drag.pitch;
  }
  if (targetIndex <= index && index < drag.fromIndex) {
    return drag.pitch;
  }
  return 0;
};

/**
 * A horizontal strip whose tiles can be long-pressed and dragged to a new
 * place; the others slide aside, and the strip scrolls near its edges. Built
 * on React Native's PanResponder and Animated only.
 */
export const ReorderableStrip = <T,>({
  items,
  keyOf,
  isReorderEnabled,
  contentContainerStyle,
  renderItem,
  footer,
  onReorder,
}: ReorderableStripProps<T>): React.ReactElement => {
  const [drag, setDrag] = useState<Drag | null>(null);
  const [targetIndex, setTargetIndex] = useState(0);

  const scroll = useRef<ScrollView>(null);
  const strip = useRef<View>(null);
  const dragX = useRef(new Animated.Value(0)).current;
  const shifts = useRef(new Map<string, Animated.Value>()).current;
  // Each tile's left edge in the strip's content, from its layout.
  const slotX = useRef(new Map<string, number>()).current;

  const live = useRef<LiveDrag>({
    drag: null,
    targetIndex: 0,
    isPanActive: false,
    gestureDx: 0,
    pointerX: 0,
    stripPageX: 0,
    stripWidth: 0,
    contentWidth: 0,
    scrollX: 0,
    scrollXAtStart: 0,
    frame: null,
    hasPendingReset: false,
  }).current;
  const latest = useRef({items, keyOf, onReorder});
  useLayoutEffect(() => {
    latest.current = {items, keyOf, onReorder};
  });

  const updateTarget = () => {
    const current = live.drag;
    if (!current) {
      return;
    }
    const offset = live.gestureDx + live.scrollX - live.scrollXAtStart;
    dragX.setValue(offset);
    const next = clamp(
      current.fromIndex + Math.round(offset / current.pitch),
      0,
      latest.current.items.length - 1,
    );
    if (next !== live.targetIndex) {
      live.targetIndex = next;
      setTargetIndex(next);
    }
  };

  const stopAutoScroll = () => {
    if (live.frame !== null) {
      cancelAnimationFrame(live.frame);
      live.frame = null;
    }
  };

  const autoScroll = () => {
    live.frame = null;
    if (!live.drag || !live.isPanActive) {
      return;
    }
    const pointer = live.pointerX - live.stripPageX;
    let step = 0;
    if (pointer < AUTO_SCROLL_EDGE) {
      step = -AUTO_SCROLL_STEP;
    } else if (pointer > live.stripWidth - AUTO_SCROLL_EDGE) {
      step = AUTO_SCROLL_STEP;
    }
    const maxScroll = Math.max(live.contentWidth - live.stripWidth, 0);
    const nextScroll = clamp(live.scrollX + step, 0, maxScroll);
    if (nextScroll !== live.scrollX) {
      live.scrollX = nextScroll;
      scroll.current?.scrollTo({x: nextScroll, animated: false});
      updateTarget();
    }
    live.frame = requestAnimationFrame(autoScroll);
  };

  const finishDrag = () => {
    stopAutoScroll();
    const current = live.drag;
    live.isPanActive = false;
    if (!current) {
      return;
    }
    const toIndex = live.targetIndex;
    Animated.timing(dragX, {
      toValue: (toIndex - current.fromIndex) * current.pitch,
      duration: SETTLE_MS,
      useNativeDriver: true,
    }).start(() => {
      live.drag = null;
      if (toIndex === current.fromIndex) {
        dragX.setValue(0);
      } else {
        // Reset once the new order is on screen (below), or the tiles jump back for a frame.
        live.hasPendingReset = true;
        latest.current.onReorder(current.key, toIndex);
      }
      setDrag(null);
    });
  };

  const pan = useRef(
    PanResponder.create({
      // Only once a long press has lifted a tile; a plain swipe still scrolls the strip.
      onMoveShouldSetPanResponderCapture: () => live.drag !== null,
      onPanResponderGrant: (_, gesture) => {
        live.isPanActive = true;
        live.pointerX = gesture.moveX;
        live.frame = requestAnimationFrame(autoScroll);
      },
      onPanResponderMove: (_, gesture) => {
        live.gestureDx = gesture.dx;
        live.pointerX = gesture.moveX;
        updateTarget();
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderRelease: finishDrag,
      onPanResponderTerminate: finishDrag,
    }),
  ).current;

  const startDrag = (index: number) => {
    const {items: currentItems, keyOf: keyOfItem} = latest.current;
    const item = currentItems[index];
    if (!isReorderEnabled || live.drag || item === undefined || currentItems.length < 2) {
      return;
    }
    const neighbour = currentItems[index === 0 ? 1 : index - 1];
    const x = slotX.get(keyOfItem(item));
    const neighbourX = neighbour === undefined ? undefined : slotX.get(keyOfItem(neighbour));
    if (x === undefined || neighbourX === undefined || x === neighbourX) {
      return;
    }
    const next: Drag = {key: keyOfItem(item), fromIndex: index, pitch: Math.abs(x - neighbourX)};
    live.drag = next;
    live.targetIndex = index;
    live.gestureDx = 0;
    live.scrollXAtStart = live.scrollX;
    dragX.setValue(0);
    strip.current?.measure((_x, _y, width, _height, pageX) => {
      live.stripPageX = pageX;
      live.stripWidth = width;
    });
    setTargetIndex(index);
    setDrag(next);
  };

  // A long press released without moving: the pan never started, so nothing else ends it.
  const endDragIfIdle = () => {
    if (live.drag && !live.isPanActive) {
      live.drag = null;
      setDrag(null);
    }
  };

  // The other tiles slide aside to show where the dragged one will land.
  useEffect(() => {
    items.forEach((item, index) => {
      const key = keyOf(item);
      if (drag && key !== drag.key) {
        Animated.timing(shiftOf(shifts, key), {
          toValue: shiftFor(index, drag, targetIndex),
          duration: SETTLE_MS,
          useNativeDriver: true,
        }).start();
      }
    });
  }, [drag, targetIndex, items, keyOf, shifts]);

  const keysInOrder = items.map(keyOf).join('\n');
  useLayoutEffect(() => {
    if (!live.hasPendingReset) {
      return;
    }
    live.hasPendingReset = false;
    dragX.setValue(0);
    shifts.forEach(shift => shift.setValue(0));
  }, [keysInOrder, live, dragX, shifts]);

  // Closed mid-drag: stop the auto-scroll loop.
  useEffect(
    () => () => {
      if (live.frame !== null) {
        cancelAnimationFrame(live.frame);
      }
    },
    [live],
  );

  const onSlotLayout = (key: string) => (event: LayoutChangeEvent) => {
    slotX.set(key, event.nativeEvent.layout.x);
  };

  return (
    <View ref={strip} {...pan.panHandlers}>
      <ScrollView
        ref={scroll}
        horizontal={true}
        scrollEnabled={drag === null}
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={event => {
          live.scrollX = event.nativeEvent.contentOffset.x;
        }}
        onContentSizeChange={width => {
          live.contentWidth = width;
        }}
        contentContainerStyle={contentContainerStyle}>
        {items.map((item, index) => {
          const key = keyOf(item);
          const isDragging = drag?.key === key;
          return (
            <Animated.View
              key={key}
              onLayout={onSlotLayout(key)}
              style={[
                isDragging ? reorderStyles.lifted : null,
                {
                  transform: isDragging
                    ? [{translateX: dragX}, {scale: LIFTED_SCALE}]
                    : [{translateX: shiftOf(shifts, key)}],
                },
              ]}>
              {renderItem(item, index, {
                isDragging,
                startDrag: () => startDrag(index),
                endDragIfIdle,
              })}
            </Animated.View>
          );
        })}
        {footer}
      </ScrollView>
    </View>
  );
};

const reorderStyles = StyleSheet.create({
  lifted: {
    zIndex: 1,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: {width: 0, height: 3},
  },
});
