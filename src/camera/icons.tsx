import React from 'react';
import {Image} from 'react-native';
import {
  ARROW_RIGHT_ICON,
  CHECK_ICON,
  CLOSE_ICON,
  CROP_ICON,
  FLASH_ICON,
  FLIP_ICON,
  MIC_ICON,
  MIC_OFF_ICON,
  PAUSE_ICON,
  PLAY_ICON,
  PLUS_ICON,
  RETAKE_ICON,
  ROTATE_ICON,
  STRAIGHTEN_ICON,
  SWITCH_CAMERA_ICON,
  TRASH_ICON,
} from './iconData';

interface IconProps {
  color: string;
}

// White icons, tinted at runtime, so the theme's icon colour applies.
const Icon: React.FC<{uri: string; color: string; size: number}> = ({uri, color, size}) => (
  <Image
    source={{uri, width: size, height: size}}
    style={{width: size, height: size, tintColor: color}}
    resizeMode="contain"
    accessibilityIgnoresInvertColors={true}
  />
);

export const CloseIcon: React.FC<IconProps & {size?: number}> = ({color, size = 24}) => (
  <Icon uri={CLOSE_ICON} color={color} size={size} />
);

export const FlashIcon: React.FC<IconProps> = ({color}) => (
  <Icon uri={FLASH_ICON} color={color} size={36} />
);

export const MicIcon: React.FC<IconProps & {isOff: boolean}> = ({color, isOff}) => (
  <Icon uri={isOff ? MIC_OFF_ICON : MIC_ICON} color={color} size={36} />
);

export const SwitchCameraIcon: React.FC<IconProps> = ({color}) => (
  <Icon uri={SWITCH_CAMERA_ICON} color={color} size={36} />
);

export const PlayIcon: React.FC<IconProps & {size?: number}> = ({color, size = 28}) => (
  <Icon uri={PLAY_ICON} color={color} size={size} />
);

export const PauseIcon: React.FC<IconProps> = ({color}) => (
  <Icon uri={PAUSE_ICON} color={color} size={24} />
);

type SizedIconProps = IconProps & {size?: number};

export const CropIcon: React.FC<SizedIconProps> = ({color, size = 22}) => (
  <Icon uri={CROP_ICON} color={color} size={size} />
);

export const RotateIcon: React.FC<SizedIconProps> = ({color, size = 22}) => (
  <Icon uri={ROTATE_ICON} color={color} size={size} />
);

export const RetakeIcon: React.FC<SizedIconProps> = ({color, size = 20}) => (
  <Icon uri={RETAKE_ICON} color={color} size={size} />
);

export const CheckIcon: React.FC<SizedIconProps> = ({color, size = 20}) => (
  <Icon uri={CHECK_ICON} color={color} size={size} />
);

export const PlusIcon: React.FC<SizedIconProps> = ({color, size = 20}) => (
  <Icon uri={PLUS_ICON} color={color} size={size} />
);

export const StraightenIcon: React.FC<SizedIconProps> = ({color, size = 22}) => (
  <Icon uri={STRAIGHTEN_ICON} color={color} size={size} />
);

export const FlipIcon: React.FC<SizedIconProps> = ({color, size = 22}) => (
  <Icon uri={FLIP_ICON} color={color} size={size} />
);

export const TrashIcon: React.FC<SizedIconProps> = ({color, size = 22}) => (
  <Icon uri={TRASH_ICON} color={color} size={size} />
);

export const ArrowRightIcon: React.FC<SizedIconProps> = ({color, size = 20}) => (
  <Icon uri={ARROW_RIGHT_ICON} color={color} size={size} />
);
