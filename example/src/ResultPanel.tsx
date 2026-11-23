import React, {useState} from 'react';
import {Image, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import type {PickedFile} from 'react-native-document-kit';
import {colors, monospace} from './controls';

export interface CallResult {
  /** The call as code, e.g. "capturePhoto({allowMultiple: true})". */
  code: string;
  /** What it resolved. */
  result: unknown;
}

const formatSize = (bytes: number): string => {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
};

const filesOf = (result: unknown): PickedFile[] => {
  if (result && typeof result === 'object' && 'files' in result && Array.isArray(result.files)) {
    return result.files as PickedFile[];
  }
  return [];
};

const statusOf = (result: unknown): string =>
  result && typeof result === 'object' && 'status' in result ? String(result.status) : 'done';

const SUCCESS = new Set(['picked', 'downloaded', 'saved', 'cleared', 'done', 'closed']);
const NEUTRAL = new Set(['cancelled']);

const badgeColors = (status: string) => {
  if (SUCCESS.has(status)) {
    return {backgroundColor: colors.successSoft, color: colors.success};
  }
  if (NEUTRAL.has(status)) {
    return {backgroundColor: colors.neutralSoft, color: colors.muted};
  }
  if (status === 'unavailable') {
    return {backgroundColor: colors.warningSoft, color: colors.warning};
  }
  return {backgroundColor: colors.dangerSoft, color: colors.danger};
};

/**
 * A topic's last call: its code, its status, and the files it returned (tap
 * one to preview it). The full result is one tap away, as JSON. Renders
 * nothing until the topic has been run.
 */
export const ResultPanel: React.FC<{last?: CallResult; onPreviewFile: (file: PickedFile) => void}> = ({
  last,
  onPreviewFile,
}) => {
  const [isCodeShown, setIsCodeShown] = useState(false);
  const [isJsonShown, setIsJsonShown] = useState(false);
  if (!last) {
    return null;
  }
  const files = filesOf(last.result);
  const status = statusOf(last.result);
  const badge = badgeColors(status);
  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <Text style={styles.title}>Result</Text>
        <View style={[styles.badge, {backgroundColor: badge.backgroundColor}]}>
          <View style={[styles.badgeDot, {backgroundColor: badge.color}]} />
          <Text style={[styles.badgeText, {color: badge.color}]}>{status}</Text>
        </View>
        {files.length > 0 ? (
          <Text style={styles.count}>
            {files.length} {files.length === 1 ? 'file' : 'files'}
          </Text>
        ) : null}
      </View>

      {files.map(file => (
        <Pressable
          key={file.uri}
          onPress={() => onPreviewFile(file)}
          accessibilityRole="button"
          accessibilityLabel={`Preview ${file.name}`}
          style={({pressed}) => [styles.file, pressed && styles.pressed]}>
          {file.mimeType.startsWith('image/') ? (
            <Image source={{uri: file.uri}} style={styles.thumbnail} />
          ) : (
            <View style={[styles.thumbnail, styles.thumbnailPlaceholder]}>
              <Text style={styles.thumbnailText} numberOfLines={1}>
                {file.extension.toUpperCase() || 'FILE'}
              </Text>
            </View>
          )}
          <View style={styles.fileText}>
            <Text style={styles.fileName} numberOfLines={1}>
              {file.name}
            </Text>
            <Text style={styles.fileDetails} numberOfLines={2}>
              {[
                formatSize(file.size),
                file.width && file.height ? `${file.width}×${file.height}` : null,
                file.durationMs ? `${Math.round(file.durationMs / 1000)} s` : null,
                file.mimeType,
                file.source,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      ))}

      <View style={styles.toggles}>
        <DetailToggle label="</>  Code" isOpen={isCodeShown} onPress={() => setIsCodeShown(shown => !shown)} />
        <DetailToggle label="{ }  JSON" isOpen={isJsonShown} onPress={() => setIsJsonShown(shown => !shown)} />
      </View>
      {isCodeShown ? (
        <View style={styles.code}>
          <ScrollView horizontal={true} showsHorizontalScrollIndicator={false}>
            <Text style={styles.codeText} selectable={true}>
              <Text style={styles.codeKeyword}>await </Text>
              {last.code}
            </Text>
          </ScrollView>
        </View>
      ) : null}
      {isJsonShown ? (
        <ScrollView horizontal={true} style={styles.json} contentContainerStyle={styles.jsonContent}>
          <Text style={styles.codeText} selectable={true}>
            {JSON.stringify(last.result, null, 2)}
          </Text>
        </ScrollView>
      ) : null}
    </View>
  );
};

/** A small pill that opens or closes one detail block (the code, the JSON). */
const DetailToggle: React.FC<{label: string; isOpen: boolean; onPress: () => void}> = ({label, isOpen, onPress}) => (
  <Pressable
    onPress={onPress}
    accessibilityRole="button"
    accessibilityState={{expanded: isOpen}}
    style={({pressed}) => [styles.toggle, isOpen && styles.toggleOpen, pressed && styles.pressed]}>
    <Text style={[styles.toggleText, isOpen && styles.toggleTextOpen]}>{label}</Text>
  </Pressable>
);

const styles = StyleSheet.create({
  panel: {
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  badgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  badgeText: {
    fontSize: 12.5,
    fontWeight: '700',
  },
  count: {
    marginLeft: 'auto',
    fontSize: 13,
    color: colors.muted,
  },
  code: {
    marginTop: 8,
    padding: 12,
    backgroundColor: colors.code,
    borderRadius: 12,
  },
  codeKeyword: {
    color: '#C4B5FD',
  },
  codeText: {
    color: colors.codeText,
    fontFamily: monospace,
    fontSize: 12.5,
    lineHeight: 19,
  },
  file: {
    marginTop: 8,
    padding: 10,
    borderRadius: 12,
    backgroundColor: colors.inset,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  thumbnail: {
    width: 48,
    height: 48,
    borderRadius: 10,
    backgroundColor: colors.track,
  },
  thumbnailPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.accentSoft,
  },
  thumbnailText: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.accent,
  },
  fileText: {
    flex: 1,
  },
  fileName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  fileDetails: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 16,
    color: colors.muted,
  },
  chevron: {
    fontSize: 24,
    color: colors.subtle,
  },
  pressed: {
    opacity: 0.7,
  },
  toggles: {
    marginTop: 12,
    flexDirection: 'row',
    gap: 8,
  },
  toggle: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  toggleOpen: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accentSoft,
  },
  toggleText: {
    fontFamily: monospace,
    fontSize: 12.5,
    fontWeight: '600',
    color: colors.muted,
  },
  toggleTextOpen: {
    color: colors.accent,
  },
  json: {
    marginTop: 8,
    backgroundColor: colors.code,
    borderRadius: 12,
  },
  jsonContent: {
    padding: 12,
  },
});
