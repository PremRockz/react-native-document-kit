import React, {useState} from 'react';
import {Image, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import type {PickedFile} from 'react-native-document-kit';
import {colors} from './controls';

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

/**
 * The last call: its code, its status, and the files it returned (tap one to
 * preview it). The full result is one tap away, as JSON.
 */
export const ResultPanel: React.FC<{last: CallResult | null; onPreviewFile: (file: PickedFile) => void}> = ({
  last,
  onPreviewFile,
}) => {
  const [isJsonShown, setIsJsonShown] = useState(false);
  if (!last) {
    return (
      <View style={styles.panel}>
        <Text style={styles.title}>Result</Text>
        <Text style={styles.empty}>Run any feature below; its call and what it returned show up here.</Text>
      </View>
    );
  }
  const files = filesOf(last.result);
  const status = statusOf(last.result);
  return (
    <View style={styles.panel}>
      <Text style={styles.title}>Result</Text>
      <ScrollView horizontal={true} style={styles.code} contentContainerStyle={styles.codeContent}>
        <Text style={styles.codeText} selectable={true}>
          {`await ${last.code}`}
        </Text>
      </ScrollView>
      <Text style={styles.status}>
        status: <Text style={status === 'picked' || status === 'downloaded' || status === 'saved' ? styles.ok : styles.other}>{status}</Text>
      </Text>
      {files.map(file => (
        <Pressable
          key={file.uri}
          onPress={() => onPreviewFile(file)}
          accessibilityRole="button"
          accessibilityLabel={`Preview ${file.name}`}
          style={styles.file}>
          {file.mimeType.startsWith('image/') ? (
            <Image source={{uri: file.uri}} style={styles.thumbnail} />
          ) : (
            <View style={[styles.thumbnail, styles.thumbnailPlaceholder]}>
              <Text style={styles.thumbnailText}>{file.extension.toUpperCase() || 'FILE'}</Text>
            </View>
          )}
          <View style={styles.fileText}>
            <Text style={styles.fileName} numberOfLines={1}>
              {file.name}
            </Text>
            <Text style={styles.fileDetails}>
              {[
                file.mimeType,
                formatSize(file.size),
                file.width && file.height ? `${file.width}×${file.height}` : null,
                file.durationMs ? `${Math.round(file.durationMs / 1000)} s` : null,
                file.source,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
          <Text style={styles.open}>Preview ›</Text>
        </Pressable>
      ))}
      <Pressable onPress={() => setIsJsonShown(shown => !shown)} accessibilityRole="button" style={styles.jsonToggle}>
        <Text style={styles.jsonToggleText}>{isJsonShown ? 'Hide JSON ▲' : 'Full result as JSON ▼'}</Text>
      </Pressable>
      {isJsonShown ? (
        <ScrollView horizontal={true} style={styles.code} contentContainerStyle={styles.codeContent}>
          <Text style={styles.codeText} selectable={true}>
            {JSON.stringify(last.result, null, 2)}
          </Text>
        </ScrollView>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  empty: {
    marginTop: 6,
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
  },
  code: {
    marginTop: 10,
    backgroundColor: colors.code,
    borderRadius: 10,
  },
  codeContent: {
    padding: 12,
  },
  codeText: {
    color: colors.codeText,
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 18,
  },
  status: {
    marginTop: 10,
    fontSize: 15,
    color: colors.text,
    fontFamily: 'monospace',
  },
  ok: {
    color: '#15803D',
    fontWeight: '700',
  },
  other: {
    color: '#B45309',
    fontWeight: '700',
  },
  file: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  thumbnail: {
    width: 52,
    height: 52,
    borderRadius: 8,
    backgroundColor: colors.border,
  },
  thumbnailPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  thumbnailText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.muted,
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
    color: colors.muted,
  },
  open: {
    color: colors.accent,
    fontWeight: '600',
  },
  jsonToggle: {
    marginTop: 12,
    alignSelf: 'flex-start',
  },
  jsonToggleText: {
    color: colors.accent,
    fontWeight: '600',
  },
});
