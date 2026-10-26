import React, {useEffect, useState} from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  Platform,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import {captureProgressStyles, useThemeStyles} from './styles';
import type {DocumentKitCameraTheme} from './types';

interface CaptureProgressProps {
  /** A photo is being written, or a stopped recording is being finished. */
  isActive: boolean;
  /** "Saving photo…" / "Saving video…". */
  label: string;
  theme: DocumentKitCameraTheme;
  isReduceMotion: boolean;
  /** Distance of the bar from the top of the screen (below the status bar). */
  barTop: number;
  /** Distance of the pill from the bottom of the screen (above the shutter). */
  pillBottom: number;
}

// Most photos are written in well under this; showing the progress for them would only flash.
const SHOW_DELAY_MS = 250;
const FADE_MS = 150;
const SWEEP_MS = 1100;
// Share of the screen width the moving stripe takes.
const STRIPE_SHARE = 0.35;

/**
 * Shown over the frozen preview while a capture is saved: a thin indeterminate
 * bar at the top in primaryColor and a pill with a spinner above the shutter.
 */
export const CaptureProgress: React.FC<CaptureProgressProps> = ({
  isActive,
  label,
  theme,
  isReduceMotion,
  barTop,
  pillBottom,
}) => {
  const themed = useThemeStyles(theme);
  const {width} = useWindowDimensions();
  const [isShown, setIsShown] = useState(false);
  const [opacity] = useState(() => new Animated.Value(0));
  const [sweep] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!isActive) {
      setIsShown(false);
      return;
    }
    const timer = setTimeout(() => setIsShown(true), SHOW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [isActive]);

  useEffect(() => {
    if (!isShown) {
      opacity.setValue(0);
      return;
    }
    Animated.timing(opacity, {toValue: 1, duration: FADE_MS, useNativeDriver: true}).start();
    // Android reads the pill through accessibilityLiveRegion; iOS needs an announcement.
    if (Platform.OS === 'ios') {
      AccessibilityInfo.announceForAccessibility(label);
    }
    if (isReduceMotion) {
      return;
    }
    sweep.setValue(0);
    const loop = Animated.loop(
      Animated.timing(sweep, {
        toValue: 1,
        duration: SWEEP_MS,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [isShown, isReduceMotion, label, opacity, sweep]);

  if (!isShown) {
    return null;
  }

  const stripeWidth = width * STRIPE_SHARE;
  return (
    <>
      <Animated.View
        pointerEvents="none"
        style={[captureProgressStyles.barTrack, {top: barTop, opacity}]}>
        <Animated.View
          style={[
            captureProgressStyles.stripe,
            themed.primaryFill,
            {width: stripeWidth},
            isReduceMotion
              ? {transform: [{translateX: (width - stripeWidth) / 2}]}
              : {
                  transform: [
                    {
                      translateX: sweep.interpolate({
                        inputRange: [0, 1],
                        outputRange: [-stripeWidth, width],
                      }),
                    },
                  ],
                },
          ]}
        />
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        style={[captureProgressStyles.pillRow, {bottom: pillBottom, opacity}]}>
        <View
          style={[captureProgressStyles.pill, themed.toast]}
          accessible={true}
          accessibilityRole="progressbar"
          accessibilityLabel={label}
          accessibilityLiveRegion="polite">
          <ActivityIndicator size="small" color={theme.textColor} />
          <Text style={[captureProgressStyles.pillText, themed.text]}>{label}</Text>
        </View>
      </Animated.View>
    </>
  );
};
