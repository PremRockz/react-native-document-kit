/**
 * Expo config plugin for react-native-document-kit.
 *
 * Usage in app.json / app.config.js:
 *
 *   "plugins": [
 *     ["react-native-document-kit", {
 *       "cameraPermission": "Take photos and videos to attach.",
 *       "microphonePermission": "Record sound with your videos."
 *     }]
 *   ]
 *
 * What it does at `expo prebuild` / EAS Build time:
 *   iOS     - adds NSCameraUsageDescription and NSMicrophoneUsageDescription
 *             (keeps texts you already set in ios.infoPlist unless you pass one here).
 *   Android - raises minSdkVersion to 29 and compileSdkVersion to 36 (the library's
 *             minimums; higher values you set are kept).
 *
 * Pass `"microphonePermission": false` to leave the microphone out entirely: no iOS
 * key, and RECORD_AUDIO is removed from the Android manifest. Videos then record
 * without sound.
 *
 * The library's own AndroidManifest (camera permission, FileProvider, preview
 * screens) is merged into the app automatically and needs nothing here.
 */

// The library does not depend on Expo, so load Expo's helpers from the app.
const loadConfigPlugins = () => {
  const paths = [process.cwd(), __dirname];
  try {
    return require(require.resolve('expo/config-plugins', {paths}));
  } catch {
    return require(require.resolve('@expo/config-plugins', {paths}));
  }
};

const {AndroidConfig, createRunOncePlugin, withGradleProperties, withInfoPlist} =
  loadConfigPlugins();

const pkg = require('./package.json');

const MIN_SDK = 29;
const COMPILE_SDK = 36;
const DEFAULT_CAMERA_TEXT = 'Allow $(PRODUCT_NAME) to use the camera to take photos and videos.';
const DEFAULT_MICROPHONE_TEXT = 'Allow $(PRODUCT_NAME) to use the microphone to record sound with videos.';

const setInfoPlistText = (infoPlist, key, value, defaultText) => {
  if (value === false) {
    return;
  }
  if (typeof value === 'string') {
    infoPlist[key] = value;
  } else if (!infoPlist[key]) {
    infoPlist[key] = defaultText;
  }
};

const withIosPermissions = (config, {cameraPermission, microphonePermission}) =>
  withInfoPlist(config, mod => {
    setInfoPlistText(mod.modResults, 'NSCameraUsageDescription', cameraPermission, DEFAULT_CAMERA_TEXT);
    setInfoPlistText(
      mod.modResults,
      'NSMicrophoneUsageDescription',
      microphonePermission,
      DEFAULT_MICROPHONE_TEXT,
    );
    return mod;
  });

/**
 * Sets `key` to at least `minimum`, keeping a higher value the app already has.
 * When the key is missing, it is only added if `defaultIsTooLow` (the app's
 * built-in default is below the minimum); otherwise the default is left alone.
 */
const raiseGradleProperty = (properties, key, minimum, defaultIsTooLow) => {
  const existing = properties.find(item => item.type === 'property' && item.key === key);
  if (!existing) {
    if (defaultIsTooLow) {
      properties.push({type: 'property', key, value: String(minimum)});
    }
    return;
  }
  const current = Number.parseInt(existing.value, 10);
  if (Number.isNaN(current) || current < minimum) {
    existing.value = String(minimum);
  }
};

const expoSdkMajor = config => Number.parseInt(String(config.sdkVersion || '0').split('.')[0], 10) || 0;

const withAndroidSdkLevels = config => {
  // Expo's default minSdk is below 29 in every SDK. Its default compileSdk is 36+
  // from SDK 54 (37 in SDK 58), so only older SDKs need it raised.
  const sdk = expoSdkMajor(config);
  return withGradleProperties(config, mod => {
    raiseGradleProperty(mod.modResults, 'android.minSdkVersion', MIN_SDK, true);
    raiseGradleProperty(mod.modResults, 'android.compileSdkVersion', COMPILE_SDK, sdk > 0 && sdk < 54);
    return mod;
  });
};

const withDocumentKit = (config, options = {}) => {
  const {cameraPermission, microphonePermission} = options || {};

  config = withIosPermissions(config, {cameraPermission, microphonePermission});
  config = withAndroidSdkLevels(config);
  if (microphonePermission === false) {
    config = AndroidConfig.Permissions.withBlockedPermissions(config, [
      'android.permission.RECORD_AUDIO',
    ]);
  }
  return config;
};

module.exports = createRunOncePlugin(withDocumentKit, pkg.name, pkg.version);
