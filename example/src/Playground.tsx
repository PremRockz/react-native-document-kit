import React, {useState} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
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
import {Button, Group, Section, Segmented, Stepper, Toggle, colors, toCode} from './controls';
import {ResultPanel} from './ResultPanel';
import type {CallResult} from './ResultPanel';
import {SAMPLE_FILES} from './samples';

const CAMERA_MODES = ['photo', 'video', 'photo + video'] as const;
const POSITION_SETS = ['back + front', 'back', 'front'] as const;
const VIDEO_QUALITIES = ['auto', 'low', 'medium', 'high'] as const;
const CROP_SHAPE_SETS = ['all shapes', 'square only', 'free only'] as const;
const LIBRARY_TYPES = ['mixed', 'photo', 'video'] as const;
const DOCUMENT_TYPES = ['any', 'PDF', 'images', 'Office'] as const;
export const ACCENTS = {Blue: '#1C6FE2', Purple: '#7C3AED', Green: '#16A34A', Orange: '#EA580C'} as const;
export type AccentName = keyof typeof ACCENTS;

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
export const Playground: React.FC<{accent: AccentName; onAccentChange: (accent: AccentName) => void}> = ({
  accent,
  onAccentChange,
}) => {
  const kit = useDocumentKit();
  const [last, setLast] = useState<CallResult | null>(null);

  // Camera
  const [cameraMode, setCameraMode] = useState<(typeof CAMERA_MODES)[number]>('photo');
  const [allowMultiple, setAllowMultiple] = useState(false);
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
  const [documentsMultiple, setDocumentsMultiple] = useState(false);
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

  /** Runs a call and shows its code and result; a blocked permission offers Settings. */
  const run = async (code: string, call: () => Promise<unknown>) => {
    const result = await call();
    setLast({code, result});
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
      return run(toCode('capturePhoto', camera), () => kit.capturePhoto(camera));
    }
    if (cameraMode === 'video') {
      const options = {...videoOptions(), ...camera};
      return run(toCode('recordVideo', options), () => kit.recordVideo(options));
    }
    const options = {...camera, modes: ['photo', 'video'] as ('photo' | 'video')[], video: videoOptions()};
    return run(toCode('openCamera', options), () => kit.openCamera(options));
  };

  const pickFromLibrary = () => {
    const options = {
      mediaType: libraryType === 'mixed' ? undefined : libraryType,
      allowMultiple: libraryMultiple || undefined,
      selectionLimit: libraryMultiple && selectionLimit > 0 ? selectionLimit : undefined,
      review: libraryReview || undefined,
    };
    return run(toCode('pickFromLibrary', options), () => kit.pickFromLibrary(options));
  };

  const pickDocuments = () => {
    const options = {allowMultiple: documentsMultiple || undefined, mimeTypes: DOCUMENT_MIME_TYPES[documentType]};
    return run(toCode('pickDocuments', options), () => kit.pickDocuments(options));
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
    return run(toCode('openPreview', fullSource, options), () => kit.openPreview(fullSource, options));
  };

  const previewPicked = (file: PickedFile) =>
    preview({uri: file.uri, name: file.name, mimeType: file.mimeType});

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
    return run(toCode('downloadFile', request), async () => {
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
    return run(toCode('saveToDevice', file, options), () => saveToDevice(file, options));
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>DocumentKit Playground</Text>
        <Text style={styles.subtitle}>
          react-native-document-kit: try every feature with your own options. The call and its result show below.
        </Text>

        <ResultPanel last={last} onPreviewFile={previewPicked} />

        <Section
          title="In-app camera"
          description="Photo and video with zoom, flash, front/back, multiple captures and the review screen with Crop & Rotate."
          actions={<Button title="Open camera" onPress={openCamera} />}>
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
          title="System camera"
          description="The phone's own camera app, e.g. as a fallback when the device has no usable camera."
          actions={
            <>
              <Button
                title="Photo"
                onPress={() => run(toCode('capturePhotoWithSystemCamera'), kit.capturePhotoWithSystemCamera)}
              />
              <Button
                title="Video"
                isSecondary={true}
                onPress={() => run(toCode('recordVideoWithSystemCamera'), () => kit.recordVideoWithSystemCamera())}
              />
            </>
          }>
          <Text style={styles.note}>No options: the system camera app decides its own look and controls.</Text>
        </Section>

        <Section
          title="Photo library"
          description="The system photo picker, no permission needed. Optionally the same review and editor as the camera."
          actions={<Button title="Pick from library" onPress={pickFromLibrary} />}>
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
          title="Documents"
          description="The system file picker: any file type, original names kept, cloud files downloaded."
          actions={<Button title="Pick documents" onPress={pickDocuments} />}>
          <Toggle label="Allow multiple" value={documentsMultiple} onChange={setDocumentsMultiple} />
          <Segmented label="File types" options={DOCUMENT_TYPES} value={documentType} onChange={setDocumentType} />
        </Section>

        <Section
          title="Preview"
          description="In-app viewers for PDF, images and text; DocumentKit's player streams video and audio."
          actions={
            <>
              {SAMPLE_FILES.map(({label, source}) => (
                <Button key={label} title={label} isSecondary={true} onPress={() => preview(source)} />
              ))}
            </>
          }>
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
          title="Download & save"
          description="Cached downloads with retry and resume, then save to Downloads (Android) or Files (iOS)."
          actions={
            <>
              <Button title={progress === null ? 'Download PDF' : `Downloading ${Math.round((progress ?? 0) * 100)}%`} onPress={download} />
              <Button title="Save to device" isSecondary={true} onPress={save} />
              <Button
                title="Clear cache"
                isSecondary={true}
                onPress={() =>
                  run(toCode('clearDownloadCache'), async () => {
                    await clearDownloadCache();
                    setDownloaded(null);
                    return {status: 'cleared'};
                  })
                }
              />
            </>
          }>
          <Toggle label="Download again (forceRefresh)" value={forceRefresh} onChange={setForceRefresh} />
          <Toggle label="Android notification" value={notification} onChange={setNotification} />
          <Text style={styles.note}>
            {downloaded ? `Cached: ${downloaded.name}${downloaded.fromCache ? ' (from cache)' : ''}` : 'Nothing downloaded yet.'}
          </Text>
        </Section>

        <Section
          title="Theme"
          description="Every colour, the font and every text of DocumentKit's screens can be set on the provider."
          actions={<Text style={styles.note}>{`<DocumentKitProvider theme={{primaryColor: '${ACCENTS[accent]}'}}>`}</Text>}>
          <Segmented label="Primary colour" options={Object.keys(ACCENTS) as AccentName[]} value={accent} onChange={onAccentChange} />
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
    padding: 16,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.text,
  },
  subtitle: {
    marginTop: 4,
    marginBottom: 16,
    fontSize: 14,
    color: colors.muted,
    lineHeight: 20,
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
