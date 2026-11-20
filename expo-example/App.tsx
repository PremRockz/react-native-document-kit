import {useState} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {StatusBar} from 'expo-status-bar';
import {SafeAreaProvider, SafeAreaView} from 'react-native-safe-area-context';
import {
  DocumentKitProvider,
  downloadFile,
  useDocumentKit,
  type PickResult,
  type PickedFile,
} from 'react-native-document-kit';

// Smoke test for react-native-document-kit in an Expo development build.
// Each button calls one feature; the result shows below so you can see it worked.

const SAMPLE_PDF = {
  uri: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
  name: 'sample.pdf',
  mimeType: 'application/pdf',
};

export default function App() {
  return (
    <SafeAreaProvider>
      <DocumentKitProvider>
        <StatusBar style="dark" />
        <SmokeTest />
      </DocumentKitProvider>
    </SafeAreaProvider>
  );
}

function SmokeTest() {
  const kit = useDocumentKit();
  const [log, setLog] = useState<string[]>([]);
  const [files, setFiles] = useState<PickedFile[]>([]);

  const report = (label: string, value: unknown) =>
    setLog(previous => [`${label}: ${JSON.stringify(value, null, 2)}`, ...previous].slice(0, 20));

  const run = (label: string, call: () => Promise<PickResult>) => async () => {
    try {
      const result = await call();
      if (result.status === 'picked') {
        setFiles(result.files);
      }
      report(label, result);
    } catch (error) {
      report(`${label} threw`, String(error));
    }
  };

  const download = async () => {
    const result = await downloadFile({url: SAMPLE_PDF.uri, fileName: SAMPLE_PDF.name});
    report('downloadFile', result.status === 'failed' ? {...result, error: String(result.error)} : result);
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>DocumentKit · Expo</Text>
        <Text style={styles.subtitle}>
          Development build test. If this screen shows, the native modules loaded.
        </Text>

        <Section title="Camera">
          <Action label="Take photo" onPress={run('capturePhoto', () => kit.capturePhoto())} />
          <Action label="Record video" onPress={run('recordVideo', () => kit.recordVideo())} />
          <Action
            label="System camera"
            onPress={run('capturePhotoWithSystemCamera', () => kit.capturePhotoWithSystemCamera())}
          />
        </Section>

        <Section title="Pick">
          <Action
            label="Photo library"
            onPress={run('pickFromLibrary', () => kit.pickFromLibrary())}
          />
          <Action label="Documents" onPress={run('pickDocuments', () => kit.pickDocuments())} />
        </Section>

        <Section title="Download & preview">
          <Action label="Download sample PDF" onPress={download} />
          <Action
            label="Preview sample PDF"
            onPress={async () => report('openPreview', await kit.openPreview(SAMPLE_PDF))}
          />
        </Section>

        {files.length > 0 && (
          <Section title="Last picked files (tap to preview)">
            {files.map(file => (
              <Action
                key={file.uri}
                label={`${file.name} · ${file.mimeType}`}
                onPress={async () =>
                  report('openPreview', await kit.openPreview({uri: file.uri, name: file.name, mimeType: file.mimeType}))
                }
              />
            ))}
          </Section>
        )}

        <Section title="Results">
          {log.length === 0 ? (
            <Text style={styles.muted}>Nothing yet. Tap a button above.</Text>
          ) : (
            log.map((line, index) => (
              <Text key={index} style={styles.log}>
                {line}
              </Text>
            ))
          )}
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({title, children}: {title: string; children: React.ReactNode}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Action({label, onPress}: {label: string; onPress: () => void}) {
  return (
    <Pressable
      onPress={onPress}
      style={({pressed}) => [styles.button, pressed && styles.buttonPressed]}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: '#F7F8FA'},
  content: {padding: 16, gap: 16},
  title: {fontSize: 24, fontWeight: '700', color: '#111827'},
  subtitle: {fontSize: 14, color: '#4B5563'},
  section: {backgroundColor: '#FFFFFF', borderRadius: 12, padding: 12, gap: 8},
  sectionTitle: {fontSize: 13, fontWeight: '600', color: '#6B7280', textTransform: 'uppercase'},
  button: {backgroundColor: '#1C6FE2', borderRadius: 8, paddingVertical: 12, paddingHorizontal: 14},
  buttonPressed: {opacity: 0.8},
  buttonText: {color: '#FFFFFF', fontSize: 15, fontWeight: '600'},
  muted: {color: '#6B7280'},
  log: {fontFamily: 'Courier', fontSize: 12, color: '#111827'},
});
