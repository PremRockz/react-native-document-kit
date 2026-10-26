import React, {useState} from 'react';
import {Pressable, Text, View} from 'react-native';
import type {LayoutChangeEvent} from 'react-native';
import type {NativePhotoEdits} from '../specs/NativeDocumentKitCamera';
import {CropOverlay} from './CropOverlay';
import {EditedPhoto} from './EditedPhoto';
import {CropIcon, FlipIcon, RetakeIcon, RotateIcon, StraightenIcon} from './icons';
import {fitAspect, flipEdits, parseAspectRatio, rotateEdits, turnedSize} from './photoEdits';
import {StraightenRuler} from './StraightenRuler';
import {cameraStyles, editorStyles, useThemeStyles} from './styles';
import type {
  CameraReviewOptions,
  CropAspectRatio,
  DocumentKitCameraLabels,
  DocumentKitCameraTheme,
} from './types';

interface Size {
  width: number;
  height: number;
}

type EditorTab = 'crop' | 'straighten' | 'rotate';

interface Preset {
  key: CropAspectRatio;
  label: string;
  /** Width / height in pixels; null is free-form. */
  ratio: number | null;
}

interface PhotoEditorProps {
  /** The screen-sized, upright copy of the photo. */
  previewUri: string;
  upright: Size;
  initialEdits: NativePhotoEdits;
  review: Required<CameraReviewOptions>;
  labels: DocumentKitCameraLabels;
  theme: DocumentKitCameraTheme;
  insets: {top: number; bottom: number};
  onCancel: () => void;
  onDone: (edits: NativePhotoEdits) => void;
}

// Two shapes this close count as the same (rounding of the frame in pixels).
const RATIO_TOLERANCE = 0.01;
const PRESET_SHAPE_PX = 22;

const toPresets = (keys: CropAspectRatio[], freeLabel: string): Preset[] =>
  keys.flatMap((key): Preset[] => {
    if (key === 'free') {
      return [{key, label: freeLabel, ratio: null}];
    }
    const ratio = parseAspectRatio(key);
    return ratio ? [{key, label: key, ratio}] : [];
  });

const sameRatio = (a: number, b: number) => Math.abs(a / b - 1) < RATIO_TOLERANCE;

/** The preset the editor opens on: the crop's own shape if one matches, else free, else the first. */
const initialPresetIndex = (presets: Preset[], edits: NativePhotoEdits, upright: Size): number => {
  const turned = turnedSize(upright, edits.rotationDegrees);
  const cropRatio = (edits.crop.width * turned.width) / (edits.crop.height * turned.height);
  const matching = presets.findIndex(preset => preset.ratio !== null && sameRatio(preset.ratio, cropRatio));
  if (matching >= 0) {
    return matching;
  }
  const free = presets.findIndex(preset => preset.ratio === null);
  return free >= 0 ? free : 0;
};

const tabsFor = (review: Required<CameraReviewOptions>): EditorTab[] => [
  ...(review.crop ? (['crop'] as const) : []),
  ...(review.straighten ? (['straighten'] as const) : []),
  ...(review.rotate || review.flip ? (['rotate'] as const) : []),
];

/**
 * Crop & Rotate: the photo with its crop frame, and tabs for crop shapes,
 * straighten and rotate / flip. Done hands the edits back; nothing is written
 * until the photo is used.
 */
export const PhotoEditor: React.FC<PhotoEditorProps> = ({
  previewUri,
  upright,
  initialEdits,
  review,
  labels,
  theme,
  insets,
  onCancel,
  onDone,
}) => {
  const themed = useThemeStyles(theme);
  const tabs = tabsFor(review);
  const [presets] = useState(() => toPresets(review.cropAspectRatios, labels.cropFree));
  const [presetIndex, setPresetIndex] = useState(() => initialPresetIndex(presets, initialEdits, upright));
  const [edits, setEdits] = useState<NativePhotoEdits>(() => {
    // A fixed shape (e.g. only '1:1') applies from the start.
    const ratio = presets[presetIndex]?.ratio;
    const turned = turnedSize(upright, initialEdits.rotationDegrees);
    const fits = ratio
      ? sameRatio(ratio, (initialEdits.crop.width * turned.width) / (initialEdits.crop.height * turned.height))
      : true;
    return fits || !ratio ? initialEdits : {...initialEdits, crop: fitAspect(ratio, turned.width, turned.height)};
  });
  const [tab, setTab] = useState<EditorTab>(tabs[0] ?? 'crop');
  const [area, setArea] = useState<Size | null>(null);

  const ratio = presets[presetIndex]?.ratio ?? null;

  const onAreaLayout = ({nativeEvent}: LayoutChangeEvent) =>
    // The area's own padding stays clear around the photo.
    setArea({width: nativeEvent.layout.width - 32, height: nativeEvent.layout.height - 32});

  const choosePreset = (index: number) => {
    setPresetIndex(index);
    const chosen = presets[index]?.ratio;
    if (chosen) {
      const turned = turnedSize(upright, edits.rotationDegrees);
      setEdits(current => ({...current, crop: fitAspect(chosen, turned.width, turned.height)}));
    }
  };

  const rotate = (direction: 'left' | 'right') => {
    const next = rotateEdits(edits, direction);
    if (ratio) {
      // The frame turned with the photo, so its shape is now the inverse one.
      const inverse = presets.findIndex(preset => preset.ratio !== null && sameRatio(preset.ratio, 1 / ratio));
      const free = presets.findIndex(preset => preset.ratio === null);
      if (inverse >= 0) {
        setPresetIndex(inverse);
      } else if (free >= 0) {
        setPresetIndex(free);
      } else {
        const turned = turnedSize(upright, next.rotationDegrees);
        next.crop = fitAspect(ratio, turned.width, turned.height);
      }
    }
    setEdits(next);
  };

  const renderPresets = () =>
    presets.length > 1 ? (
      <View style={editorStyles.presets}>
        {presets.map((preset, index) => {
          const isSelected = index === presetIndex;
          const color = isSelected ? theme.primaryColor : theme.iconColor;
          const shape = preset.ratio
            ? {
                width: preset.ratio >= 1 ? PRESET_SHAPE_PX : PRESET_SHAPE_PX * preset.ratio,
                height: preset.ratio >= 1 ? PRESET_SHAPE_PX / preset.ratio : PRESET_SHAPE_PX,
              }
            : {width: PRESET_SHAPE_PX - 2, height: PRESET_SHAPE_PX - 2, borderStyle: 'dashed' as const};
          return (
            <Pressable
              key={preset.key}
              onPress={() => choosePreset(index)}
              accessibilityRole="button"
              accessibilityLabel={preset.label}
              accessibilityState={{selected: isSelected}}
              style={editorStyles.preset}>
              <View style={editorStyles.presetShapeBox}>
                <View style={[editorStyles.presetShape, shape, {borderColor: color}]} />
              </View>
              <Text style={[editorStyles.presetLabel, isSelected ? themed.primaryText : themed.text]}>
                {preset.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    ) : null;

  const renderRotateButtons = () => (
    <View style={editorStyles.rotateButtons}>
      {review.rotate ? (
        <>
          <RotateButton
            label={labels.rotateLeft}
            icon={<RetakeIcon color={theme.iconColor} size={22} />}
            theme={theme}
            onPress={() => rotate('left')}
          />
          <RotateButton
            label={labels.rotateRight}
            icon={<RotateIcon color={theme.iconColor} />}
            theme={theme}
            onPress={() => rotate('right')}
          />
        </>
      ) : null}
      {review.flip ? (
        <RotateButton
          label={labels.flip}
          icon={<FlipIcon color={theme.iconColor} />}
          theme={theme}
          onPress={() => setEdits(flipEdits(edits))}
        />
      ) : null}
    </View>
  );

  const renderPanel = () => {
    switch (tab) {
      case 'straighten':
        return (
          <StraightenRuler
            value={edits.straightenDegrees}
            label={labels.straighten}
            theme={theme}
            onChange={degrees => setEdits(current => ({...current, straightenDegrees: degrees}))}
          />
        );
      case 'rotate':
        return renderRotateButtons();
      default:
        return renderPresets();
    }
  };

  return (
    <View style={[cameraStyles.container, themed.screen]}>
      <View style={[editorStyles.topBar, {paddingTop: insets.top + 8}]}>
        <Pressable
          onPress={onCancel}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={labels.cropCancel}
          style={editorStyles.textButton}>
          <Text style={[editorStyles.textButtonLabel, themed.text]}>{labels.cropCancel}</Text>
        </Pressable>
        <Pressable
          onPress={() => onDone(edits)}
          accessibilityRole="button"
          accessibilityLabel={labels.done}
          style={({pressed}) => [editorStyles.doneButton, themed.primaryFill, pressed && cameraStyles.buttonDimmed]}>
          <Text style={[editorStyles.doneLabel, themed.onPrimaryText]}>{labels.done}</Text>
        </Pressable>
      </View>

      <View style={editorStyles.imageArea} onLayout={onAreaLayout}>
        {area && area.width > 0 && area.height > 0 ? (
          <EditedPhoto
            uri={previewUri}
            upright={upright}
            area={area}
            edits={edits}
            isFullFrame={true}
            renderOverlay={frame => (
              <CropOverlay
                width={frame.width}
                height={frame.height}
                rect={edits.crop}
                aspectRatio={ratio}
                isInteractive={tab === 'crop'}
                theme={theme}
                onChange={crop => setEdits(current => ({...current, crop}))}
              />
            )}
          />
        ) : null}
      </View>

      <View style={editorStyles.panel}>{renderPanel()}</View>

      {tabs.length > 1 ? (
        <View
          style={[editorStyles.tabs, themed.outlineBorder, {paddingBottom: Math.max(insets.bottom, 8) + 4}]}
          accessibilityRole="tablist">
          {tabs.map(key => {
            const isActive = key === tab;
            const color = isActive ? theme.primaryColor : theme.iconColor;
            const label = {crop: labels.crop, straighten: labels.straighten, rotate: labels.rotate}[key];
            const Icon = {crop: CropIcon, straighten: StraightenIcon, rotate: RotateIcon}[key];
            return (
              <Pressable
                key={key}
                onPress={() => setTab(key)}
                accessibilityRole="tab"
                accessibilityLabel={label}
                accessibilityState={{selected: isActive}}
                style={editorStyles.tab}>
                {isActive ? <View style={[editorStyles.tabIndicator, themed.primaryFill]} /> : null}
                <Icon color={color} />
                <Text style={[editorStyles.tabLabel, isActive ? themed.primaryText : themed.text]}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <View style={{height: Math.max(insets.bottom, 8)}} />
      )}
    </View>
  );
};

interface RotateButtonProps {
  label: string;
  icon: React.ReactNode;
  theme: DocumentKitCameraTheme;
  onPress: () => void;
}

const RotateButton: React.FC<RotateButtonProps> = ({label, icon, theme, onPress}) => {
  const themed = useThemeStyles(theme);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({pressed}) => [editorStyles.rotateButton, themed.outlineBorder, pressed && cameraStyles.buttonDimmed]}>
      {icon}
      <Text style={[editorStyles.rotateLabel, themed.text]}>{label}</Text>
    </Pressable>
  );
};
