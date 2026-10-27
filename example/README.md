# DocumentKit Playground

A demo app for [react-native-document-kit](../README.md). One screen covers every feature:
- the in-app camera
- the system camera
- the photo library
- documents
- preview
- download and save
- theming

Each feature has its options as switches and pickers. Run it and you see the exact
call that was made (as code you can copy) and what it returned. Tap any returned
file to preview it.

[![Try it in your browser](https://img.shields.io/badge/%E2%96%B6%20Try%20it-in%20your%20browser-1C6FE2?style=for-the-badge)](https://appetize.io/app/b_grlhwnmqijfqcq4kxve2kg3n6i)

The same app, live in your browser on a streamed Android phone (no install).

## Run it

You need a React Native 0.86 environment:
- **Android:** Android Studio and SDK 36.
- **iOS:** Xcode 16+ and CocoaPods.

```sh
# 1. Build the library once (the app uses it from the parent folder)
cd react-native-document-kit
npm install
npm run build

# 2. Install and run the playground
cd example
npm install
npm run android          # or: cd ios && bundle install && bundle exec pod install && cd .. && npm run ios
```

The app depends on the library with `"react-native-document-kit": "file:.."`, and
Metro watches the parent folder. Changes to the library's JS (`../src`) reload
live. Changes to its native code (`../android`, `../ios`) need the app rebuilt.

## Build the demo APK

```sh
cd example/android
# Phones only (ARM): about 45 MB instead of 72 MB with the emulator's x86 parts
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a,armeabi-v7a
# → app/build/outputs/apk/release/app-release.apk
```

The release build is signed with the debug key, which is fine for a demo download
but not for the Play Store.

## Where things are

| File | What it does |
|---|---|
| `App.tsx` | Mounts `DocumentKitProvider` (the theme can be switched live) |
| `src/Playground.tsx` | The screen: one section per feature, with its options |
| `src/ResultPanel.tsx` | The last call as code, its status, and the returned files |
| `src/controls.tsx` | Switches, pickers, steppers and the code formatter |
| `src/samples.ts` | Public files used by Preview and Download |
