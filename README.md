# react-native-document-kit

Camera, photo library, document picker, downloads, saving and in-app preview for
React Native, in one package with one result shape.

[![npm version](https://img.shields.io/npm/v/react-native-document-kit?color=1C6FE2)](https://www.npmjs.com/package/react-native-document-kit)
[![npm downloads](https://img.shields.io/npm/dw/react-native-document-kit)](https://www.npmjs.com/package/react-native-document-kit)
[![license](https://img.shields.io/npm/l/react-native-document-kit)](https://github.com/PremRockz/react-native-document-kit/blob/main/LICENSE)

[![Try it in your browser](https://img.shields.io/badge/%E2%96%B6%20Try%20it-in%20your%20browser-1C6FE2?style=for-the-badge)](https://appetize.io/app/b_grlhwnmqijfqcq4kxve2kg3n6i)
[![Documentation](https://img.shields.io/badge/Read-the%20docs-111827?style=for-the-badge)](https://premrockz.github.io/react-native-document-kit/)

🤖 **Android:** ready · 🍎 **iOS:** experimental · ⚡ **New Architecture** · 📄 **MIT**

<p align="center">
  <img src="https://raw.githubusercontent.com/PremRockz/react-native-document-kit/main/docs/images/camera.jpg" width="190" alt="In-app camera" />
  <img src="https://raw.githubusercontent.com/PremRockz/react-native-document-kit/main/docs/images/review.jpg" width="190" alt="Review screen" />
  <img src="https://raw.githubusercontent.com/PremRockz/react-native-document-kit/main/docs/images/crop.jpg" width="190" alt="Crop and rotate" />
  <img src="https://raw.githubusercontent.com/PremRockz/react-native-document-kit/main/docs/images/video.jpg" width="190" alt="Video player" />
</p>
<p align="center"><sub>Camera · Review · Crop &amp; Rotate · Video player</sub></p>

> 🍎 **About iOS:** the iOS code is complete and compiles against React Native
> 0.86, but it hasn't been run on a device yet. If you try it, please
> [report what you find](https://github.com/PremRockz/react-native-document-kit/issues).

## ✨ Features

| | Feature | What you get |
|---|---|---|
| 📸 | **In-app camera** | Photo and video in one screen: pinch zoom, 0.5× / 1× / 2× lenses, tap to focus, flash, front/back, pause/resume, multi-capture |
| 📱 | **System camera** | The phone's own camera app as a fallback |
| 🖼️ | **Photo library** | System photo picker, photos and/or videos, single or multiple, no permission needed |
| 📂 | **Document picker** | Files, Google Drive, iCloud… filtered by type, original names kept |
| ⬇️ | **Downloads** | Cached, retried and resumed, with progress, cancel and a notification |
| 💾 | **Save to device** | `Download/` folder on Android (no permission), Save to Files on iOS |
| 👀 | **In-app preview** | PDF, images, text, CSV and HTML; video and audio streamed |
| 🎨 | **Theming & text** | Every colour, the font and every label can be changed |

## 🚀 Why use it

- 📦 **No extra packages.** Only `react` and `react-native`. Nothing else to install or link, and no version clashes with other camera or picker libraries.
- ⚡ **Fast.** The camera starts while the permission prompt is still open, and a file downloaded once opens instantly next time.
- 🛡️ **Never throws.** Every call resolves a result with a `status`. Cancelled, denied and busy are normal outcomes, so no `try`/`catch`.
- 🧩 **One result shape.** The camera, the library and the document picker all return the same file object, so your upload code doesn't care where it came from.
- 📶 **Built for slow networks.** Video quality follows the connection, downloads retry and resume, and video and audio stream instead of downloading first.
- 👆 **Double-tap safe.** If a screen is already open, a second call returns `busy` instead of stacking screens.
- 🗂️ **Files that stay.** Every returned file is a copy in your app's cache, still readable after the picker closes, ready for uploads and retries.
- 🔐 **Expired sessions handled.** On a 401/403, `onUnauthorized` asks you for fresh headers and retries once.
- 🏗️ **New Architecture native.** TurboModules and a Fabric camera view: Kotlin with CameraX and Media3 on Android, Objective-C++ on iOS.

## 📦 Install

```sh
npm install react-native-document-kit
cd ios && pod install
```

Needs React Native 0.79 or later with the New Architecture, iOS 15+, and Android
`minSdkVersion` 29 with `compileSdkVersion` 36. Rebuild the app after installing.
iOS also needs camera and microphone keys in `Info.plist` (see the docs).

### Expo

Works with a **development build** (`npx expo prebuild` or EAS Build), not in
**Expo Go**, because it has its own native code. Use Expo SDK 53 or later (New
Architecture), then set the Android SDK levels and the iOS keys in `app.json`:

```json
{
  "expo": {
    "ios": {
      "infoPlist": {
        "NSCameraUsageDescription": "Take photos and videos to attach.",
        "NSMicrophoneUsageDescription": "Record sound with your videos."
      }
    },
    "plugins": [
      ["expo-build-properties", {"android": {"minSdkVersion": 29, "compileSdkVersion": 36}}]
    ]
  }
}
```

Install the plugin with `npx expo install expo-build-properties`. Expo support
hasn't been tested in an app yet, so reports are welcome.

## ⚡ Quick start

```tsx
import {DocumentKitProvider, useDocumentKit} from 'react-native-document-kit';

// 1. Once, near the root of your app
export const App = () => (
  <DocumentKitProvider>
    <Root />
  </DocumentKitProvider>
);

// 2. Anywhere below it
const AttachPhoto = () => {
  const {capturePhoto} = useDocumentKit();

  const attach = async () => {
    const result = await capturePhoto();
    if (result.status === 'picked') {
      await upload(result.files[0]); // {uri, name, mimeType, size, ...}
    }
  };

  return <Button title="Take photo" onPress={attach} />;
};
```

## 📖 Documentation

The **[documentation site](https://premrockz.github.io/react-native-document-kit/)**
covers the whole API, permissions, theming, translations, expired sessions
(401/403), recipes and troubleshooting. It's also on GitHub as
[one Markdown file](https://github.com/PremRockz/react-native-document-kit/blob/main/docs/GUIDE.md).

## 🤝 Contributing and issues

Found a bug or have an idea? [Open an issue](https://github.com/PremRockz/react-native-document-kit/issues).
iOS and Expo reports are especially welcome. Pull requests are welcome too; the
[Playground app](https://github.com/PremRockz/react-native-document-kit/tree/main/example)
is the quickest way to try a change.

## 📄 License

MIT

## ❤️ Support

If you like the package, please support it: give the repo a star and
**[subscribe on YouTube](https://www.youtube.com/channel/UCY1m2KQz71Hd3SvQE4lqsow)**. ❤️
