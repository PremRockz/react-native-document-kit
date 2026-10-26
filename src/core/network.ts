import NativeDocumentKitNetwork from '../specs/NativeDocumentKitNetwork';
import type {NativeNetworkSnapshot} from '../specs/NativeDocumentKitNetwork';
import type {DocumentKitErrorReporter} from './types';

/** How much video the current network can realistically upload. */
export type RecordingQuality = 'low' | 'medium' | 'high';

// Upload speed (kbps) at or above which a tier is used.
const HIGH_QUALITY_MIN_UPSTREAM_KBPS = 10_000;
const MEDIUM_QUALITY_MIN_UPSTREAM_KBPS = 2_000;

/**
 * Picks a recording quality for the network:
 * - Data saver / Low Data Mode, or offline → low (the upload will wait or be slow)
 * - Android's upload-speed estimate when there is one: ≥10 Mbps high, ≥2 Mbps medium, else low
 * - Otherwise by connection: Wi-Fi/Ethernet high (medium if metered),
 *   5G/4G medium, 3G/2G low, unknown cellular medium
 */
export const toRecordingQuality = (
  snapshot: NativeNetworkSnapshot,
): RecordingQuality => {
  if (snapshot.isDataSaverOn || snapshot.transport === 'none') {
    return 'low';
  }
  if (snapshot.upstreamKbps > 0) {
    if (snapshot.upstreamKbps >= HIGH_QUALITY_MIN_UPSTREAM_KBPS) {
      return 'high';
    }
    return snapshot.upstreamKbps >= MEDIUM_QUALITY_MIN_UPSTREAM_KBPS
      ? 'medium'
      : 'low';
  }
  switch (snapshot.transport) {
    case 'wifi':
    case 'ethernet':
      return snapshot.isMetered ? 'medium' : 'high';
    case 'cellular':
      return snapshot.cellularGeneration === '3g' ||
        snapshot.cellularGeneration === '2g'
        ? 'low'
        : 'medium';
    default:
      return 'medium';
  }
};

/** Reads the network and picks a quality; falls back to medium if the read fails. */
export const detectRecordingQuality = async (
  reportError: DocumentKitErrorReporter,
): Promise<RecordingQuality> => {
  try {
    return toRecordingQuality(await NativeDocumentKitNetwork.getNetworkSnapshot());
  } catch (error) {
    reportError(error, {operation: 'network_read'});
    return 'medium';
  }
};
