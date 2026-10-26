const js = require('@eslint/js');
const globals = require('globals');
const reactHooks = require('eslint-plugin-react-hooks');
const tseslint = require('typescript-eslint');

/** @type {import('eslint').Linter.Config[]} */
module.exports = [
  {
    ignores: ['node_modules/**', 'lib/**', 'android/**', 'ios/**'],
  },
  {
    files: ['*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: globals.node,
    },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['*.js'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react-native-permissions',
              message: "Use DocumentKit's own native permission module (src/specs).",
            },
            {
              name: 'react-native-image-picker',
              message: "Use DocumentKit's own media picker module (src/specs).",
            },
            {
              name: '@react-native-documents/picker',
              message: 'DocumentKit will ship its own file picker module.',
            },
            {
              name: 'react-native-vision-camera',
              message: "Use DocumentKit's own camera (DocumentKitCameraView, NativeDocumentKitCamera).",
            },
            {
              name: 'react-native-blob-util',
              message: 'Native results already carry the file size; add native code for other file work.',
            },
            {
              name: 'react-native-svg',
              message: 'Use bundled PNG icons tinted with tintColor (src/camera/icons.tsx).',
            },
          ],
        },
      ],
    },
  },
];
