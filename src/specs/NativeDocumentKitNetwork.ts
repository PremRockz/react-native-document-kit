import type {TurboModule} from 'react-native';
import {TurboModuleRegistry} from 'react-native';

export type NativeNetworkSnapshot = {
  /** "wifi" | "cellular" | "ethernet" | "other" | "none" */
  transport: string;
  /** "5g" | "4g" | "3g" | "2g" | "unknown"; only meaningful on cellular. */
  cellularGeneration: string;
  /** OS estimate of upload speed in kbps; -1 when the OS gives none (always on iOS). */
  upstreamKbps: number;
  /** Metered connection (Android) or "expensive" path (iOS). */
  isMetered: boolean;
  /** iOS Low Data Mode; Android data saver for this app. */
  isDataSaverOn: boolean;
};

/** Reads the current connection so recording quality can match the network. */
export interface Spec extends TurboModule {
  getNetworkSnapshot(): Promise<NativeNetworkSnapshot>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('DocumentKitNetwork');
