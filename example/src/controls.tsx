import React, {useState} from 'react';
import {Platform, Pressable, StyleSheet, Switch, Text, View} from 'react-native';
import type {LayoutChangeEvent} from 'react-native';

/** The playground's own look (the library's screens use DocumentKit's theme). */
export const colors = {
  background: '#F2F4F7',
  card: '#FFFFFF',
  inset: '#F7F8FA',
  track: '#E9ECF1',
  text: '#101828',
  muted: '#667085',
  subtle: '#98A2B3',
  border: '#EAECF0',
  accent: '#1C6FE2',
  accentSoft: '#EAF2FE',
  code: '#0F172A',
  codeText: '#E2E8F0',
  codeMuted: '#94A3B8',
  success: '#067647',
  successSoft: '#ECFDF3',
  warning: '#B54708',
  warningSoft: '#FFFAEB',
  danger: '#B42318',
  dangerSoft: '#FEF3F2',
  neutralSoft: '#F2F4F7',
};

export const monospace = Platform.select({ios: 'Menlo', default: 'monospace'});

/**
 * A feature: an icon, a title, a short description, its options (collapsible),
 * its buttons and its last result.
 */
export const Section: React.FC<{
  icon: string;
  /** Background of the icon tile. */
  tint: string;
  title: string;
  description: string;
  children: React.ReactNode;
  actions: React.ReactNode;
  /** Shown under the buttons, e.g. download progress. */
  footer?: React.ReactNode;
  /** This topic's last call and result, shown under its buttons. */
  result?: React.ReactNode;
  onLayout?: (event: LayoutChangeEvent) => void;
}> = ({icon, tint, title, description, children, actions, footer, result, onLayout}) => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <View style={styles.section} onLayout={onLayout}>
      <View style={styles.sectionHeader}>
        <View style={[styles.iconTile, {backgroundColor: tint}]}>
          <Text style={styles.icon}>{icon}</Text>
        </View>
        <View style={styles.sectionHeading}>
          <Text style={styles.sectionTitle}>{title}</Text>
          <Text style={styles.sectionDescription}>{description}</Text>
        </View>
      </View>

      <Pressable
        onPress={() => setIsOpen(open => !open)}
        accessibilityRole="button"
        accessibilityLabel={`${title} options`}
        accessibilityState={{expanded: isOpen}}
        style={({pressed}) => [styles.optionsToggle, isOpen && styles.optionsToggleOpen, pressed && styles.pressed]}>
        <Text style={styles.optionsToggleText}>Options</Text>
        <Text style={[styles.chevron, isOpen && styles.chevronOpen]}>›</Text>
      </Pressable>
      {isOpen ? <View style={styles.options}>{children}</View> : null}

      <View style={styles.actions}>{actions}</View>
      {footer}
      {result}
    </View>
  );
};

/** A sub-heading inside a section's options. */
export const Group: React.FC<{title: string}> = ({title}) => <Text style={styles.group}>{title}</Text>;

export const Toggle: React.FC<{label: string; value: boolean; onChange: (value: boolean) => void}> = ({
  label,
  value,
  onChange,
}) => (
  <View style={styles.row}>
    <Text style={styles.label}>{label}</Text>
    <Switch
      value={value}
      onValueChange={onChange}
      trackColor={{true: colors.accent, false: colors.track}}
      thumbColor={Platform.OS === 'android' ? '#FFFFFF' : undefined}
      ios_backgroundColor={colors.track}
    />
  </View>
);

/** A segmented control: one choice out of a few, each segment equally wide. */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.rowStacked}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.segments} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {options.map(option => {
          const isSelected = option === value;
          return (
            <Pressable
              key={option}
              onPress={() => onChange(option)}
              accessibilityRole="radio"
              accessibilityState={{selected: isSelected}}
              style={[styles.segment, isSelected && styles.segmentSelected]}>
              <Text
                style={[styles.segmentText, isSelected && styles.segmentTextSelected]}
                numberOfLines={1}
                adjustsFontSizeToFit={true}
                minimumFontScale={0.8}>
                {option}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export const Stepper: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Shown instead of the number at this value, e.g. "no limit" at 0. */
  zeroLabel?: string;
  onChange: (value: number) => void;
}> = ({label, value, min, max, step = 1, zeroLabel, onChange}) => (
  <View style={styles.row}>
    <Text style={styles.label}>{label}</Text>
    <View style={styles.stepper}>
      <Pressable
        onPress={() => onChange(Math.max(min, value - step))}
        disabled={value <= min}
        accessibilityRole="button"
        accessibilityLabel={`Decrease ${label}`}
        style={({pressed}) => [styles.stepButton, pressed && styles.pressed]}>
        <Text style={[styles.stepButtonText, value <= min && styles.stepButtonTextDisabled]}>−</Text>
      </Pressable>
      <Text style={styles.stepValue} numberOfLines={1}>
        {value === 0 && zeroLabel ? zeroLabel : value}
      </Text>
      <Pressable
        onPress={() => onChange(Math.min(max, value + step))}
        disabled={value >= max}
        accessibilityRole="button"
        accessibilityLabel={`Increase ${label}`}
        style={({pressed}) => [styles.stepButton, pressed && styles.pressed]}>
        <Text style={[styles.stepButtonText, value >= max && styles.stepButtonTextDisabled]}>+</Text>
      </Pressable>
    </View>
  </View>
);

/** Buttons share their row equally: one is full width, two are half each, and so on. */
export const Button: React.FC<{title: string; onPress: () => void; isSecondary?: boolean; isDisabled?: boolean}> = ({
  title,
  onPress,
  isSecondary = false,
  isDisabled = false,
}) => (
  <Pressable
    onPress={onPress}
    disabled={isDisabled}
    accessibilityRole="button"
    accessibilityState={{disabled: isDisabled}}
    style={({pressed}) => [
      styles.button,
      isSecondary && styles.buttonSecondary,
      isDisabled && styles.buttonDisabled,
      pressed && styles.pressed,
    ]}>
    <Text style={[styles.buttonText, isSecondary && styles.buttonTextSecondary]} numberOfLines={1}>
      {title}
    </Text>
  </Pressable>
);

/** A thin bar for download progress, 0 to 1. */
export const ProgressBar: React.FC<{fraction: number}> = ({fraction}) => (
  <View style={styles.progressTrack} accessibilityRole="progressbar" accessibilityValue={{min: 0, max: 100, now: Math.round(fraction * 100)}}>
    <View style={[styles.progressFill, {width: `${Math.max(2, Math.min(100, fraction * 100))}%`}]} />
  </View>
);

/** Writes an options object as the JS a developer would type: `capturePhoto({allowMultiple: true})`. */
export const toCode = (call: string, ...args: unknown[]): string => {
  const format = (value: unknown, indent: string): string => {
    if (Array.isArray(value)) {
      return `[${value.map(item => format(item, indent)).join(', ')}]`;
    }
    if (value && typeof value === 'object') {
      const inner = `${indent}  `;
      // An option that is undefined, or an object of only defaults ({}), is left out.
      const entries = Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, format(item, inner)] as const)
        .filter(([, written]) => written !== '{}');
      if (entries.length === 0) {
        return '{}';
      }
      return `{\n${entries.map(([key, written]) => `${inner}${key}: ${written},`).join('\n')}\n${indent}}`;
    }
    return typeof value === 'string' ? `'${value}'` : String(value);
  };
  // Leaves out what would be undefined or {}: that is just the defaults.
  const written = args.map(arg => (arg === undefined ? '{}' : format(arg, ''))).filter(arg => arg !== '{}');
  return `${call}(${written.join(', ')})`;
};

const styles = StyleSheet.create({
  section: {
    backgroundColor: colors.card,
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    shadowColor: '#101828',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: {width: 0, height: 2},
    elevation: 1,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  iconTile: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  icon: {
    fontSize: 22,
  },
  sectionHeading: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
  },
  sectionDescription: {
    marginTop: 3,
    fontSize: 13.5,
    color: colors.muted,
    lineHeight: 19,
  },
  optionsToggle: {
    marginTop: 14,
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: colors.inset,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  optionsToggleOpen: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  optionsToggleText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  chevron: {
    fontSize: 22,
    lineHeight: 24,
    color: colors.subtle,
    transform: [{rotate: '90deg'}],
  },
  chevronOpen: {
    transform: [{rotate: '-90deg'}],
  },
  options: {
    paddingHorizontal: 14,
    paddingBottom: 8,
    backgroundColor: colors.inset,
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  group: {
    marginTop: 18,
    marginBottom: 2,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    color: colors.subtle,
    textTransform: 'uppercase',
  },
  actions: {
    marginTop: 14,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  row: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowStacked: {
    paddingVertical: 10,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  label: {
    fontSize: 15,
    color: colors.text,
    flexShrink: 1,
  },
  segments: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: 10,
    backgroundColor: colors.track,
  },
  segment: {
    flex: 1,
    minHeight: 34,
    paddingHorizontal: 6,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  segmentSelected: {
    backgroundColor: colors.card,
    shadowColor: '#101828',
    shadowOpacity: 0.12,
    shadowRadius: 3,
    shadowOffset: {width: 0, height: 1},
    elevation: 2,
  },
  segmentText: {
    color: colors.muted,
    fontSize: 13.5,
    fontWeight: '500',
  },
  segmentTextSelected: {
    color: colors.text,
    fontWeight: '700',
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    backgroundColor: colors.track,
    padding: 3,
  },
  stepButton: {
    width: 34,
    height: 30,
    borderRadius: 8,
    backgroundColor: colors.card,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepButtonText: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.accent,
  },
  stepButtonTextDisabled: {
    color: colors.subtle,
  },
  stepValue: {
    minWidth: 64,
    paddingHorizontal: 6,
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  button: {
    flexGrow: 1,
    flexBasis: '30%',
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonSecondary: {
    backgroundColor: colors.accentSoft,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
  buttonTextSecondary: {
    color: colors.accent,
  },
  pressed: {
    opacity: 0.7,
  },
  progressTrack: {
    marginTop: 12,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.track,
    overflow: 'hidden',
  },
  progressFill: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.accent,
  },
});
