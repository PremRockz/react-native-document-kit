# Expo test app

A small Expo app that checks [react-native-document-kit](../README.md) works in an
Expo **development build**. One screen has a button per feature (camera, video,
system camera, photo library, documents, download, preview) and shows each result.

It uses the library's config plugin from [`app.json`](app.json):

```json
"plugins": [
  ["react-native-document-kit", {
    "cameraPermission": "Take photos and videos to attach.",
    "microphonePermission": "Record sound with your videos."
  }]
]
```

> This does **not** run in Expo Go or Snack: the library has its own native code,
> which Expo Go can't load.

## Run it

```sh
# 1. Build the library once (the app uses it from the parent folder)
cd react-native-document-kit
npm install
npm run build

# 2. Install, generate the native projects and run on a phone or emulator
cd expo-example
npm install
npm run prebuild     # expo prebuild --clean: writes ./android and ./ios
npm run android      # or: npm run ios
```

The app depends on the library with `"react-native-document-kit": "file:.."`, and
Metro watches the parent folder, so changes to the library's JS reload live. After
changing its native code or `app.plugin.js`, run `npm run prebuild` and build again.

## What to check

| Button | Expected |
|---|---|
| Take photo / Record video | Permission prompt, then the in-app camera. Result `status: "picked"` |
| System camera | The phone's camera app opens |
| Photo library / Documents | System pickers, no permission prompt |
| Download sample PDF | `status: "downloaded"` with a local file |
| Preview sample PDF | Full-screen PDF viewer |
| Tap a picked file | Opens it in the in-app preview |

Please [report what you find](https://github.com/PremRockz/react-native-document-kit/issues),
especially on iOS.
