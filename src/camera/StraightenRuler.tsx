import React, {useEffect, useRef, useState} from 'react';
import {PanResponder, Pressable, Text, View} from 'react-native';
import type {LayoutChangeEvent} from 'react-native';
import {MAX_STRAIGHTEN_DEGREES} from './photoEdits';
import {rulerStyles, useThemeStyles} from './styles';
import type {DocumentKitCameraTheme} from './types';

interface StraightenRulerProps {
  /** −45 to 45, clockwise. */
  value: number;
  label: string;
  theme: DocumentKitCameraTheme;
  onChange: (degrees: number) => void;
}

const PX_PER_DEGREE = 8;
// Within this of level, the ruler rests at 0°.
const SNAP_DEGREES = 0.5;
const TICK_DEGREES = Array.from({length: MAX_STRAIGHTEN_DEGREES * 2 + 1}, (_, index) => index - MAX_STRAIGHTEN_DEGREES);

const toDegrees = (value: number): number => {
  const clamped = Math.min(Math.max(value, -MAX_STRAIGHTEN_DEGREES), MAX_STRAIGHTEN_DEGREES);
  return Math.abs(clamped) < SNAP_DEGREES ? 0 : Math.round(clamped * 10) / 10;
};

/**
 * Straighten: drag the ruler left or right; the angle shows above it. Tapping
 * the angle sets it back to 0°.
 */
export const StraightenRuler: React.FC<StraightenRulerProps> = ({value, label, theme, onChange}) => {
  const themed = useThemeStyles(theme);
  const [width, setWidth] = useState(0);
  const latest = useRef({value, onChange});
  useEffect(() => {
    latest.current = {value, onChange};
  });
  const startValue = useRef(0);

  const [responder] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        startValue.current = latest.current.value;
      },
      // Dragging the ruler left moves its scale left: the angle goes up.
      onPanResponderMove: (_, gesture) =>
        latest.current.onChange(toDegrees(startValue.current - gesture.dx / PX_PER_DEGREE)),
    }),
  );

  const onLayout = ({nativeEvent}: LayoutChangeEvent) => setWidth(nativeEvent.layout.width);
  const center = width / 2;
  const shown = Math.round(value);

  return (
    <View style={rulerStyles.container}>
      <Pressable
        onPress={() => onChange(0)}
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{min: -MAX_STRAIGHTEN_DEGREES, max: MAX_STRAIGHTEN_DEGREES, now: shown, text: `${shown}°`}}
        accessibilityActions={[{name: 'increment'}, {name: 'decrement'}]}
        onAccessibilityAction={event =>
          onChange(toDegrees(value + (event.nativeEvent.actionName === 'increment' ? 1 : -1)))
        }
        hitSlop={8}>
        <Text style={[rulerStyles.value, themed.text]}>{`${shown}°`}</Text>
      </Pressable>
      <View style={rulerStyles.track} onLayout={onLayout} {...responder.panHandlers}>
        {width > 0
          ? TICK_DEGREES.map(degrees => {
              const x = center + (degrees - value) * PX_PER_DEGREE;
              if (x < 0 || x > width) {
                return null;
              }
              const isMajor = degrees % 10 === 0;
              return (
                <View
                  key={degrees}
                  pointerEvents="none"
                  style={[
                    rulerStyles.tick,
                    isMajor ? rulerStyles.tickMajor : rulerStyles.tickMinor,
                    themed.iconFill,
                    {left: x},
                  ]}
                />
              );
            })
          : null}
        <View pointerEvents="none" style={[rulerStyles.needle, themed.iconFill, {left: center - 1}]} />
      </View>
    </View>
  );
};
