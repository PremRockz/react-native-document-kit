const path = require('path');
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

// The library lives in the parent folder (react-native-document-kit). Metro
// watches it so library changes reload live, but resolves react and
// react-native from this app only: two copies would crash the app.
const libraryRoot = path.resolve(__dirname, '..');
const escape = value => value.replace(/[/\\^$*+?.()|[\]{}-]/g, '\\$&');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  watchFolders: [libraryRoot],
  resolver: {
    blockList: [new RegExp(`^${escape(path.join(libraryRoot, 'node_modules'))}/.*`)],
    nodeModulesPaths: [path.resolve(__dirname, 'node_modules')],
    extraNodeModules: {
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-native': path.resolve(__dirname, 'node_modules/react-native'),
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
