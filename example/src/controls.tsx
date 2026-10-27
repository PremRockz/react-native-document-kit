import React, {useState} from 'react';
import {Pressable, StyleSheet, Switch, Text, View} from 'react-native';

/** The playground's own look (the library's screens use DocumentKit's theme). */
export const colors = {
  background: '#F4F5F7',
  card: '#FFFFFF',
  text: '#111827',
  muted: '#6B7280',
  border: '#E5E7EB',
  accent: '#1C6FE2',
  code: '#0F172A',
  codeText: '#E2E8F0',
};

/** A feature: a title, a short description, its options (collapsible) and its buttons. */
export const Section: React.FC<{
  title: string;
  description: string;
  children: React.ReactNode;
  actions: React.ReactNode;
}> = ({title, description, children, actions}) => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionDescription}>{description}</Text>
      <Pressable
        onPress={() => setIsOpen(open => !open)}
        accessibilityRole="button"
        accessibilityState={{expanded: isOpen}}
        style={styles.optionsToggle}>
        <Text style={styles.optionsToggleText}>{isOpen ? 'Hide options ▲' : 'Options ▼'}</Text>
      </Pressable>
      {isOpen ? <View style={styles.options}>{children}</View> : null}
      <View style={styles.actions}>{actions}</View>
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
      trackColor={{true: colors.accent}}
      thumbColor={value ? '#FFFFFF' : undefined}
    />
  </View>
);

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
      <View style={styles.segments}>
        {options.map(option => {
          const isSelected = option === value;
          return (
            <Pressable
              key={option}
              onPress={() => onChange(option)}
              accessibilityRole="button"
              accessibilityState={{selected: isSelected}}
              style={[styles.segment, isSelected && styles.segmentSelected]}>
              <Text style={[styles.segmentText, isSelected && styles.segmentTextSelected]}>{option}</Text>
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
        accessibilityRole="button"
        accessibilityLabel={`Decrease ${label}`}
        style={styles.stepButton}>
        <Text style={styles.stepButtonText}>−</Text>
      </Pressable>
      <Text style={styles.stepValue}>{value === 0 && zeroLabel ? zeroLabel : value}</Text>
      <Pressable
        onPress={() => onChange(Math.min(max, value + step))}
        accessibilityRole="button"
        accessibilityLabel={`Increase ${label}`}
        style={styles.stepButton}>
        <Text style={styles.stepButtonText}>+</Text>
      </Pressable>
    </View>
  </View>
);

export const Button: React.FC<{title: string; onPress: () => void; isSecondary?: boolean}> = ({
  title,
  onPress,
  isSecondary = false,
}) => (
  <Pressable
    onPress={onPress}
    accessibilityRole="button"
    style={({pressed}) => [styles.button, isSecondary && styles.buttonSecondary, pressed && styles.pressed]}>
    <Text style={[styles.buttonText, isSecondary && styles.buttonTextSecondary]}>{title}</Text>
  </Pressable>
);

/** Writes an options object as the JS a developer would type: `capturePhoto({allowMultiple: true})`. */
export const toCode = (call: string, ...args: unknown[]): string => {
  const format = (value: unknown, indent: string): string => {
    if (Array.isArray(value)) {
      return `[${value.map(item => format(item, indent)).join(', ')}]`;
    }
    if (value && typeof value === 'object') {
      const entries = Object.entries(value).filter(([, item]) => item !== undefined);
      if (entries.length === 0) {
        return '{}';
      }
      const inner = `${indent}  `;
      return `{\n${entries.map(([key, item]) => `${inner}${key}: ${format(item, inner)},`).join('\n')}\n${indent}}`;
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
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  sectionDescription: {
    marginTop: 4,
    fontSize: 14,
    color: colors.muted,
    lineHeight: 20,
  },
  optionsToggle: {
    alignSelf: 'flex-start',
    marginTop: 10,
    paddingVertical: 4,
  },
  optionsToggleText: {
    color: colors.accent,
    fontWeight: '600',
  },
  options: {
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  group: {
    marginTop: 12,
    marginBottom: 2,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    color: colors.muted,
    textTransform: 'uppercase',
  },
  actions: {
    marginTop: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  rowStacked: {
    paddingVertical: 6,
    gap: 6,
  },
  label: {
    fontSize: 15,
    color: colors.text,
    flexShrink: 1,
  },
  segments: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  segment: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  segmentSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  segmentText: {
    color: colors.text,
    fontSize: 14,
  },
  segmentTextSelected: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stepButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepButtonText: {
    fontSize: 18,
    color: colors.text,
  },
  stepValue: {
    minWidth: 56,
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  button: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: colors.accent,
  },
  buttonSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.accent,
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 15,
  },
  buttonTextSecondary: {
    color: colors.accent,
  },
  pressed: {
    opacity: 0.6,
  },
});
