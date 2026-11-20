const path = require('path');
const {getDefaultConfig} = require('expo/metro-config');

// The library lives in the parent folder (react-native-document-kit). Metro
// watches it so library changes reload live, but resolves react and
// react-native from this app only: two copies would crash the app.
const projectRoot = __dirname;
const libraryRoot = path.resolve(projectRoot, '..');
const escape = value => value.replace(/[/\\^$*+?.()|[\]{}-]/g, '\\$&');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [libraryRoot];
config.resolver.blockList = [
  new RegExp(`^${escape(path.join(libraryRoot, 'node_modules'))}/.*`),
  new RegExp(`^${escape(path.join(libraryRoot, 'example'))}/.*`),
];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];
config.resolver.extraNodeModules = {
  react: path.resolve(projectRoot, 'node_modules/react'),
  'react-native': path.resolve(projectRoot, 'node_modules/react-native'),
};

module.exports = config;
