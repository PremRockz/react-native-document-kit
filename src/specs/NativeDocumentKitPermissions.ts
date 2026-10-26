import type {TurboModule} from 'react-native';
import {TurboModuleRegistry} from 'react-native';

/**
 * Native camera and microphone permission module.
 *
 * Status strings (codegen cannot type string unions, so JS narrows them):
 * - "granted"     permission given
 * - "promptable"  not granted, but the OS will still show the prompt
 * - "blocked"     not granted and the OS will not prompt again; only Settings can grant it
 * - "unavailable" the device has no camera / microphone
 */
export interface Spec extends TurboModule {
  getCameraPermissionStatus(): Promise<string>;
  /** Shows the OS prompt only when the status is "promptable". Resolves the resulting status. */
  requestCameraPermission(): Promise<string>;
  getMicrophonePermissionStatus(): Promise<string>;
  /** Same contract as requestCameraPermission, for recording video with sound. */
  requestMicrophonePermission(): Promise<string>;
  getNotificationPermissionStatus(): Promise<string>;
  /** Same contract, for download notifications (Android 13+ asks; older Android follows app settings). */
  requestNotificationPermission(): Promise<string>;
  openSettings(): Promise<void>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('DocumentKitPermissions');
