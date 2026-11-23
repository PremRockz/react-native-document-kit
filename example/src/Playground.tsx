import React, {useRef, useState} from 'react';
import {Platform, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {
  clearDownloadCache,
  downloadFile,
  openAppSettings,
  saveToDevice,
  useDocumentKit,
} from 'react-native-document-kit';
import type {
  CameraReviewOptions,
  CaptureOptions,
  CropAspectRatio,
  DownloadedFile,
  LibraryMediaType,
  PickResult,
  PickedFile,
  PlayerOptions,
  PreviewSource,
  RecordVideoOptions,
} from 'react-native-document-kit';
import {Button, Group, ProgressBar, Section, Segmented, Stepper, Toggle, colors, toCode} from './controls';
import {ResultPanel} from './ResultPanel';
import type {CallResult} from './ResultPanel';
import {SAMPLE_FILES} from './samples';

const CAMERA_MODES = ['photo', 'video', 'photo + video'] as const;
const POSITION_SETS = ['back + front', 'back', 'front'] as const;
const VIDEO_QUALITIES = ['auto', 'low', 'medium', 'high'] as const;
const CROP_SHAPE_SETS = ['all shapes', 'square only', 'free only'] as const;
const LIBRARY_TYPES = ['mixed', 'photo', 'video'] as const;
const DOCUMENT_TYPES = ['any', 'PDF', 'images', 'Office'] as const;

/** The topics that run calls; each keeps and shows its own last result. */
type Topic = 'camera' | 'systemCamera' | 'library' | 'documents' | 'preview' | 'download';

/** The shortcuts at the top, in screen order. */
const NAV: {topic: Topic; label: string}[] = [
  {topic: 'camera', label: 'Camera'},
  {topic: 'systemCamera', label: 'System camera'},
  {topic: 'library', label: 'Library'},
  {topic: 'documents', label: 'Documents'},
  {topic: 'preview', label: 'Preview'},
  {topic: 'download', label: 'Download'},
];

/** Icon tile backgrounds, one soft colour per feature. */
const TINTS: Record<Topic, string> = {
  camera: '#EAF2FE',
  systemCamera: '#F4F3FF',
  library: '#ECFDF3',
  documents: '#FFFAEB',
  preview: '#F0F9FF',
  download: '#FDF2FA',
};

const CROP_SHAPES: Record<(typeof CROP_SHAPE_SETS)[number], CropAspectRatio[] | undefined> = {
  'all shapes': undefined,
  'square only': ['1:1'],
  'free only': [],
};

const DOCUMENT_MIME_TYPES: Record<(typeof DOCUMENT_TYPES)[number], string[] | undefined> = {
  any: undefined,
  PDF: ['application/pdf'],
  images: ['image/*'],
  Office: [
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ],
};

/** Only the review options that differ from the defaults (all on), as an app would write them. */
const changedReview = (review: Required<Omit<CameraReviewOptions, 'cropAspectRatios'>>, shapes?: CropAspectRatio[]) => {
  const changed: CameraReviewOptions = Object.fromEntries(Object.entries(review).filter(([, isOn]) => !isOn));
  if (shapes) {
    changed.cropAspectRatios = shapes;
  }
  return Object.keys(changed).length > 0 ? changed : undefined;
};

/**
 * Every DocumentKit feature on one screen: pick the options, run it, and see
 * the exact call and what it returned.
 */
export const Playground: React.FC = () => {
  const kit = useDocumentKit();
  const [results, setResults] = useState<Partial<Record<Topic, CallResult>>>({});

  // Shortcuts: each section reports where it sits, a shortcut scrolls there.
  const scrollRef = useRef<ScrollView>(null);
  const sectionY = useRef<Partial<Record<Topic, number>>>({});
  const navHeight = useRef(0);
  const placeOf = (topic: Topic) => ({
    onLayout: ({nativeEvent}: {nativeEvent: {layout: {y: number}}}) => {
      sectionY.current[topic] = nativeEvent.layout.y;
    },
    tint: TINTS[topic],
  });
  const scrollTo = (topic: Topic) => {
    const y = sectionY.current[topic];
    if (y !== undefined) {
      scrollRef.current?.scrollTo({y: Math.max(0, y - navHeight.current - 8), animated: true});
    }
  };

  // Camera
  const [cameraMode, setCameraMode] = useState<(typeof CAMERA_MODES)[number]>('photo + video');
  const [allowMultiple, setAllowMultiple] = useState(true);
  const [maxFiles, setMaxFiles] = useState(10);
  const [positionSet, setPositionSet] = useState<(typeof POSITION_SETS)[number]>('back + front');
  const [initialPosition, setInitialPosition] = useState<'back' | 'front'>('back');
  const [allowZoom, setAllowZoom] = useState(true);
  const [allowFlash, setAllowFlash] = useState(true);
  const [videoQuality, setVideoQuality] = useState<(typeof VIDEO_QUALITIES)[number]>('auto');
  const [maxDuration, setMaxDuration] = useState(0);
  const [audio, setAudio] = useState(true);
  const [review, setReview] = useState({
    enabled: true,
    header: true,
    crop: true,
    straighten: true,
    rotate: true,
    flip: true,
    remove: true,
    addMore: true,
    reorder: true,
  });
  const [cropShapes, setCropShapes] = useState<(typeof CROP_SHAPE_SETS)[number]>('all shapes');

  // Library and documents
  const [libraryType, setLibraryType] = useState<LibraryMediaType>('mixed');
  const [libraryMultiple, setLibraryMultiple] = useState(false);
  const [selectionLimit, setSelectionLimit] = useState(0);
  const [libraryReview, setLibraryReview] = useState(true);
  const [documentsMultiple, setDocumentsMultiple] = useState(true);
  const [documentType, setDocumentType] = useState<(typeof DOCUMENT_TYPES)[number]>('any');

  // Preview and download
  const [player, setPlayer] = useState<Required<PlayerOptions>>({
    autoPlay: true,
    skipBackSeconds: 5,
    skipForwardSeconds: 15,
    allowSpeed: true,
    allowFullScreen: true,
  });
  const [muted, setMuted] = useState(false);
  const [canSave, setCanSave] = useState(true);
  const [forceRefresh, setForceRefresh] = useState(false);
  const [notification, setNotification] = useState(true);
  const [progress, setProgress] = useState<number | null>(null);
  const [downloaded, setDownloaded] = useState<DownloadedFile | null>(null);

  /** Runs a call and shows its code and result in its topic; a blocked permission offers Settings. */
  const run = async (topic: Topic, code: string, call: () => Promise<unknown>) => {
    const result = await call();
    setResults(current => ({...current, [topic]: {code, result}}));
    const pick = result as PickResult;
    if (pick?.status === 'permission_denied' && pick.isBlocked) {
      await openAppSettings();
    }
  };

  const cameraOptions = (): CaptureOptions => ({
    allowMultiple: allowMultiple || undefined,
    maxFiles: allowMultiple && maxFiles !== 10 ? maxFiles : undefined,
    positions: positionSet === 'back + front' ? undefined : [positionSet],
    initialPosition: positionSet === 'back + front' && initialPosition === 'front' ? 'front' : undefined,
    allowZoom: allowZoom ? undefined : false,
    allowFlash: allowFlash ? undefined : false,
    review: changedReview(review, CROP_SHAPES[cropShapes]),
  });

  const videoOptions = (): RecordVideoOptions => ({
    quality: videoQuality === 'auto' ? undefined : videoQuality,
    maxDurationSeconds: maxDuration || undefined,
    audio: audio ? undefined : false,
  });

  const openCamera = () => {
    const camera = cameraOptions();
    if (cameraMode === 'photo') {
      return run('camera', toCode('capturePhoto', camera), () => kit.capturePhoto(camera));
    }
    if (cameraMode === 'video') {
      const options = {...videoOptions(), ...camera};
      return run('camera', toCode('recordVideo', options), () => kit.recordVideo(options));
    }
    const options = {...camera, modes: ['photo', 'video'] as ('photo' | 'video')[], video: videoOptions()};
    return run('camera', toCode('openCamera', options), () => kit.openCamera(options));
  };

  const pickFromLibrary = () => {
    const options = {
      mediaType: libraryType === 'mixed' ? undefined : libraryType,
      allowMultiple: libraryMultiple || undefined,
      selectionLimit: libraryMultiple && selectionLimit > 0 ? selectionLimit : undefined,
      review: libraryReview || undefined,
    };
    return run('library', toCode('pickFromLibrary', options), () => kit.pickFromLibrary(options));
  };

  const pickDocuments = () => {
    const options = {allowMultiple: documentsMultiple || undefined, mimeTypes: DOCUMENT_MIME_TYPES[documentType]};
    return run('documents', toCode('pickDocuments', options), () => kit.pickDocuments(options));
  };

  const playerOptions = (): PlayerOptions | undefined => {
    const defaults: Required<PlayerOptions> = {
      autoPlay: true,
      skipBackSeconds: 5,
      skipForwardSeconds: 15,
      allowSpeed: true,
      allowFullScreen: true,
    };
    const changed = Object.fromEntries(
      Object.entries(player).filter(([key, value]) => defaults[key as keyof PlayerOptions] !== value),
    );
    return Object.keys(changed).length > 0 ? changed : undefined;
  };

  const preview = (source: PreviewSource) => {
    const fullSource = {...source, forceRefresh: forceRefresh || undefined};
    const options = {
      save: canSave ? {subdirectory: 'DocumentKit Playground'} : undefined,
      muted: muted || undefined,
      player: playerOptions(),
    };
    return run('preview', toCode('openPreview', fullSource, options), () => kit.openPreview(fullSource, options));
  };

  /** Previews a returned file; its result goes to Preview, so the list it came from stays. */
  const previewPicked = (file: PickedFile) =>
    preview({uri: file.uri, name: file.name, mimeType: file.mimeType});

  const resultOf = (topic: Topic) => <ResultPanel last={results[topic]} onPreviewFile={previewPicked} />;

  const download = () => {
    const sample = SAMPLE_FILES[0].source;
    const request = {
      url: sample.uri,
      fileName: sample.name,
      cacheKey: sample.cacheKey,
      forceRefresh: forceRefresh || undefined,
      notification: notification ? {tag: 'playground-pdf', title: sample.name} : undefined,
    };
    setProgress(0);
    return run('download', toCode('downloadFile', request), async () => {
      const result = await downloadFile({...request, onProgress: ({fraction}) => setProgress(fraction)});
      setProgress(null);
      if (result.status === 'downloaded') {
        setDownloaded(result.file);
      }
      return result;
    });
  };

  const save = () => {
    if (!downloaded) {
      return;
    }
    const file = {uri: downloaded.uri, name: downloaded.name, mimeType: downloaded.mimeType};
    const options = {
      subdirectory: 'DocumentKit Playground',
      notification: notification ? {tag: 'playground-pdf', title: downloaded.name} : undefined,
    };
    return run('download', toCode('saveToDevice', file, options), () => saveToDevice(file, options));
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <ScrollView ref={scrollRef} contentContainerStyle={styles.content} stickyHeaderIndices={[1]}>
        <View style={styles.header}>
          <View style={styles.brandRow}>
            <View style={styles.logo}>
              <Text style={styles.logoText}>DK</Text>
            </View>
            <View style={styles.brandText}>
              <Text style={styles.title}>DocumentKit</Text>
              <Text style={styles.packageName}>react-native-document-kit</Text>
            </View>
            <View style={styles.platformChip}>
              <Text style={styles.platformChipText}>{Platform.OS === 'ios' ? 'iOS' : 'Android'}</Text>
            </View>
          </View>
          <Text style={styles.subtitle}>
            Pick the options, run a feature, and see the exact call and what it returned.
          </Text>
        </View>

        <View
          style={styles.nav}
          onLayout={({nativeEvent}) => {
            navHeight.current = nativeEvent.layout.height;
          }}>
          <ScrollView horizontal={true} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.navContent}>
            {NAV.map(({topic, label}) => (
              <Pressable
                key={topic}
                onPress={() => scrollTo(topic)}
                accessibilityRole="button"
                accessibilityLabel={`Go to ${label}`}
                style={({pressed}) => [styles.navChip, pressed && styles.navChipPressed]}>
                <Text style={styles.navChipText}>{label}</Text>
                {results[topic] ? <View style={styles.navDot} /> : null}
              </Pressable>
            ))}
          </ScrollView>
        </View>

        <Section
          icon="📷"
          {...placeOf('camera')}
          title="In-app camera"
          description="Photo and video with zoom, flash, front/back, multiple captures and the review screen with Crop & Rotate."
          actions={<Button title="Open camera" onPress={openCamera} />}
          result={resultOf('camera')}>
          <Segmented label="Mode" options={CAMERA_MODES} value={cameraMode} onChange={setCameraMode} />
          <Toggle label="Allow multiple captures" value={allowMultiple} onChange={setAllowMultiple} />
          {allowMultiple ? (
            <Stepper label="Max files" value={maxFiles} min={2} max={30} onChange={setMaxFiles} />
          ) : null}
          <Segmented label="Cameras" options={POSITION_SETS} value={positionSet} onChange={setPositionSet} />
          {positionSet === 'back + front' ? (
            <Segmented label="Opens on" options={['back', 'front'] as const} value={initialPosition} onChange={setInitialPosition} />
          ) : null}
          <Toggle label="Zoom (pinch, lens buttons)" value={allowZoom} onChange={setAllowZoom} />
          <Toggle label="Flash" value={allowFlash} onChange={setAllowFlash} />
          {cameraMode !== 'photo' ? (
            <>
              <Group title="Video" />
              <Segmented label="Quality" options={VIDEO_QUALITIES} value={videoQuality} onChange={setVideoQuality} />
              <Stepper
                label="Max length (s)"
                value={maxDuration}
                min={0}
                max={300}
                step={15}
                zeroLabel="none"
                onChange={setMaxDuration}
              />
              <Toggle label="Record sound" value={audio} onChange={setAudio} />
            </>
          ) : null}
          <Group title="Review screen" />
          {(Object.keys(review) as (keyof typeof review)[]).map(key => (
            <Toggle
              key={key}
              label={key === 'enabled' ? 'Show the review' : key}
              value={review[key]}
              onChange={value => setReview(current => ({...current, [key]: value}))}
            />
          ))}
          <Segmented label="Crop shapes" options={CROP_SHAPE_SETS} value={cropShapes} onChange={setCropShapes} />
        </Section>

        <Section
          icon="📱"
          {...placeOf('systemCamera')}
          title="System camera"
          description="The phone's own camera app, e.g. as a fallback when the device has no usable camera."
          actions={
            <>
              <Button
                title="Photo"
                onPress={() =>
                  run('systemCamera', toCode('capturePhotoWithSystemCamera'), kit.capturePhotoWithSystemCamera)
                }
              />
              <Button
                title="Video"
                isSecondary={true}
                onPress={() =>
                  run('systemCamera', toCode('recordVideoWithSystemCamera'), () => kit.recordVideoWithSystemCamera())
                }
              />
            </>
          }
          result={resultOf('systemCamera')}>
          <Text style={styles.note}>No options: the system camera app decides its own look and controls.</Text>
        </Section>

        <Section
          icon="🖼️"
          {...placeOf('library')}
          title="Photo library"
          description="The system photo picker, no permission needed. Optionally the same review and editor as the camera."
          actions={<Button title="Pick from library" onPress={pickFromLibrary} />}
          result={resultOf('library')}>
          <Segmented label="Media" options={LIBRARY_TYPES} value={libraryType} onChange={setLibraryType} />
          <Toggle label="Allow multiple" value={libraryMultiple} onChange={setLibraryMultiple} />
          {libraryMultiple ? (
            <Stepper
              label="Selection limit"
              value={selectionLimit}
              min={0}
              max={20}
              zeroLabel="no limit"
              onChange={setSelectionLimit}
            />
          ) : null}
          <Toggle label="Review & edit after picking" value={libraryReview} onChange={setLibraryReview} />
        </Section>

        <Section
          icon="📄"
          {...placeOf('documents')}
          title="Documents"
          description="The system file picker: any file type, original names kept, cloud files downloaded."
          actions={<Button title="Pick documents" onPress={pickDocuments} />}
          result={resultOf('documents')}>
          <Toggle label="Allow multiple" value={documentsMultiple} onChange={setDocumentsMultiple} />
          <Segmented label="File types" options={DOCUMENT_TYPES} value={documentType} onChange={setDocumentType} />
        </Section>

        <Section
          icon="🔍"
          {...placeOf('preview')}
          title="Preview"
          description="In-app viewers for PDF, images and text; DocumentKit's player streams video and audio."
          actions={
            <>
              {SAMPLE_FILES.map(({label, source}) => (
                <Button key={label} title={label} isSecondary={true} onPress={() => preview(source)} />
              ))}
            </>
          }
          result={resultOf('preview')}>
          <Toggle label="Save button (Android viewers, player)" value={canSave} onChange={setCanSave} />
          <Toggle label="Download again (forceRefresh)" value={forceRefresh} onChange={setForceRefresh} />
          <Group title="Video / audio player" />
          <Toggle label="Auto play" value={player.autoPlay} onChange={autoPlay => setPlayer(p => ({...p, autoPlay}))} />
          <Toggle label="Start muted" value={muted} onChange={setMuted} />
          <Stepper
            label="Back button (s)"
            value={player.skipBackSeconds}
            min={0}
            max={30}
            step={5}
            zeroLabel="hidden"
            onChange={skipBackSeconds => setPlayer(p => ({...p, skipBackSeconds}))}
          />
          <Stepper
            label="Forward button (s)"
            value={player.skipForwardSeconds}
            min={0}
            max={60}
            step={5}
            zeroLabel="hidden"
            onChange={skipForwardSeconds => setPlayer(p => ({...p, skipForwardSeconds}))}
          />
          <Toggle label="Speed button" value={player.allowSpeed} onChange={allowSpeed => setPlayer(p => ({...p, allowSpeed}))} />
          <Toggle
            label="Full-screen button"
            value={player.allowFullScreen}
            onChange={allowFullScreen => setPlayer(p => ({...p, allowFullScreen}))}
          />
        </Section>

        <Section
          icon="📥"
          {...placeOf('download')}
          title="Download & save"
          description="Cached downloads with retry and resume, then save to Downloads (Android) or Files (iOS)."
          footer={progress === null ? null : <ProgressBar fraction={progress} />}
          actions={
            <>
              <Button
                title={progress === null ? 'Download PDF' : `Downloading ${Math.round(progress * 100)}%`}
                isDisabled={progress !== null}
                onPress={download}
              />
              <Button title="Save to device" isSecondary={true} isDisabled={!downloaded} onPress={save} />
              <Button
                title="Clear cache"
                isSecondary={true}
                onPress={() =>
                  run('download', toCode('clearDownloadCache'), async () => {
                    await clearDownloadCache();
                    setDownloaded(null);
                    return {status: 'cleared'};
                  })
                }
              />
            </>
          }
          result={resultOf('download')}>
          <Toggle label="Download again (forceRefresh)" value={forceRefresh} onChange={setForceRefresh} />
          <Toggle label="Android notification" value={notification} onChange={setNotification} />
          <Text style={styles.note}>
            {downloaded ? `Cached: ${downloaded.name}${downloaded.fromCache ? ' (from cache)' : ''}` : 'Nothing downloaded yet.'}
          </Text>
        </Section>

        <View style={styles.footer} />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  header: {
    paddingTop: 8,
    paddingBottom: 4,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  logo: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  brandText: {
    flex: 1,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.text,
  },
  packageName: {
    fontSize: 13,
    color: colors.muted,
  },
  platformChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: colors.accentSoft,
  },
  platformChipText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: colors.accent,
  },
  subtitle: {
    marginTop: 12,
    fontSize: 14.5,
    color: colors.muted,
    lineHeight: 20,
  },
  nav: {
    marginHorizontal: -16,
    paddingVertical: 10,
    marginBottom: 6,
    backgroundColor: colors.background,
  },
  navContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  navChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  navChipPressed: {
    backgroundColor: colors.accentSoft,
  },
  navChipText: {
    fontSize: 13.5,
    fontWeight: '600',
    color: colors.text,
  },
  navDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.success,
  },
  note: {
    fontSize: 13,
    color: colors.muted,
    paddingVertical: 4,
  },
  footer: {
    height: 32,
  },
});
