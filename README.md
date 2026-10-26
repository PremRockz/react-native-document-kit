# react-native-document-kit

Every way a file gets into or out of a React Native app, in one package:

- an **in-app camera** for photos and video
- the phone's **own camera app**
- the **photo library** and the **document picker** (Files, Google Drive, iCloud…)
- **downloads** with caching, retries and resume
- **saving** to the device
- full-screen **in-app preview** for PDFs, images, text, video and audio

It is built on its own native code: Kotlin with CameraX and Media3 on Android,
Objective-C++ with AVFoundation and QuickLook on iOS. From npm it needs only
`react` and `react-native`.

> **Status: 0.1, early.**
> - **Android:** ready. Every feature has been tested on a real device.
> - **iOS: experimental.** The code is complete and compiles against React
>   Native 0.86, but it has not yet been run in an app or on a device.
>   Reports and fixes are welcome.
>
> Expect changes before 1.0.

## Contents

- [Why DocumentKit](#why-documentkit)
- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Quick start](#quick-start)
- [How results work](#how-results-work)
- [API reference](#api-reference)
  - [`<DocumentKitProvider>`](#documentkitprovider)
  - [`useDocumentKit()`](#usedocumentkit)
  - [Camera](#camera)
  - [Photo library and documents](#photo-library-and-documents)
  - [Preview](#preview)
  - [Download, save and cache](#download-save-and-cache)
  - [`openAppSettings()`](#openappsettings)
  - [Types](#types)
- [Expired sessions (401 / 403)](#expired-sessions-401--403)
- [Recipes](#recipes)
- [Theming](#theming)
- [Translations (labels)](#translations-labels)
- [Monitoring and speed](#monitoring-and-speed)
- [Platform notes](#platform-notes)
- [Troubleshooting](#troubleshooting)
- [Known limitations](#known-limitations)
- [Development](#development)
- [Publishing](#publishing)
- [License](#license)

## Why DocumentKit

- **One package, one result shape.** The camera, the photo library and the
  document picker all resolve the same `PickResult` with the same `PickedFile`,
  so your upload code doesn't care where a file came from.
- **Never throws.** Every call resolves a result with a `status` that you
  `switch` on. Cancelled, permission denied and busy are normal outcomes, not
  exceptions, so you don't need `try`/`catch`.
- **One screen at a time.** If a camera, picker or preview is already open, a
  second call resolves `busy` instead of stacking screens. Double taps are safe.
- **Files you can keep.** Everything returned is a copy in your app's cache, so
  it is still readable after the picker closes, for uploads and retries.
  Temporary `content://` permissions and picker temp files can't expire under you.
- **Built for slow networks.**
  - Video quality follows the connection.
  - Downloads retry and resume.
  - Video and audio previews stream instead of downloading first.
  - A file downloaded once opens instantly next time.
- **Fast camera.** The camera can start while the permission prompt is still
  open, so the live picture appears sooner.
- **Fits your app.**
  - Every colour, the font and every piece of text can be changed.
  - Errors go to your own monitoring; users never see raw errors.
- **Few dependencies.** It has no other React Native libraries to install or
  link, and no version conflicts with other camera or picker packages, apart
  from one optional CameraX setting explained [below](#android-camerax-version).
- **New Architecture.** It uses TurboModules and a Fabric camera view, with types
  generated from its specs.

## Features

| Area | What you get |
|---|---|
| In-app camera | Photo and video in one screen. Pinch zoom, lens buttons (0.5× / 1× / 2× where available), tap to focus, flash off / auto / on (torch for video, switchable while recording), microphone on/off switch, front/back switch, swipe between Photo and Video, pause/resume while recording, time limit, icons that turn with the phone, multi-capture with a review list |
| Camera output | Photos at full sensor resolution; front-camera photos not mirrored (text reads correctly); video as MP4 / H.264 at 480p, 720p or 1080p, chosen from the network by default |
| System camera | The phone's camera app for photo or video, as a fallback |
| Photo library | System photo picker (no permission needed), photos, videos or both, single or multiple. On iOS, HEIC arrives as JPEG and video as MP4 |
| Documents | System document picker (no permission needed), filtered by MIME type, single or multiple, original file names kept, cloud files downloaded |
| Download | Cache of 200 MB (least recently used removed first), up to 4 attempts with backoff, resume with `Range`, 60 s idle timeout, shared transfer for the same file, progress, cancel, Android notification |
| Save | Android: `Download/<folder>` with no permission. iOS: the Save to Files sheet |
| Preview | PDF, images, text, CSV and HTML in native viewers. Video and audio streamed. Office files in QuickLook (iOS) or "Open with" (Android). A cancellable progress card is shown only when a download is needed |

## Requirements

| | |
|---|---|
| React Native | 0.79 or later, **New Architecture only** (TurboModules + Fabric) |
| iOS | 15.0 or later |
| Android | `minSdkVersion` 29 (Android 10) or later, `compileSdkVersion` 36, Android Gradle Plugin 8.9.1 or later |

The old architecture (bridge) is not supported.

Apps created from the React Native 0.79 or 0.80 template use `compileSdkVersion`
35. Raise it to 36 in `android/build.gradle`, or the build fails at
`checkAarMetadata`. Your app's `minSdkVersion` must also be at least 29.

## Installation

```sh
npm install react-native-document-kit
# or
yarn add react-native-document-kit

cd ios && pod install
```

Android needs no extra steps (autolinking). Rebuild the app after installing,
because the package contains native code. A JS reload is not enough.

### iOS: Info.plist

Add these keys to your app's `Info.plist`. iOS closes any app that uses the
camera or microphone without them.

```xml
<key>NSCameraUsageDescription</key>
<string>Take photos and videos to attach.</string>
<key>NSMicrophoneUsageDescription</key>
<string>Record sound with your videos.</string>
```

The photo library, the document picker and Save to Files need no permission.

### Android: permissions

The library's manifest adds these permissions:

- `CAMERA`
- `RECORD_AUDIO`, for video sound
- `ACCESS_NETWORK_STATE`, to choose the video quality
- `POST_NOTIFICATIONS`, for download notifications

Remove any you don't use in your app's `AndroidManifest.xml`:

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
          xmlns:tools="http://schemas.android.com/tools">
  <uses-permission android:name="android.permission.RECORD_AUDIO" tools:node="remove" />
</manifest>
```

The photo library and document picker need no permission. If you remove
`RECORD_AUDIO`, videos record without sound.

The manifest also marks the camera, autofocus and microphone as optional
(`uses-feature android:required="false"`), so Google Play still offers your
app on tablets and Chromebooks without them.

### Android: CameraX version

Only needed if your app uses another camera library.

Gradle resolves one CameraX version for the whole app. DocumentKit uses CameraX
1.6.2 by default. If your app also ships another CameraX-based library, such as
`react-native-vision-camera`, pin the version that library was built for in
`android/build.gradle`:

```groovy
buildscript {
    ext {
        documentKitCameraXVersion = "1.5.0-alpha03" // react-native-vision-camera 4.7.x
    }
}
```

## Quick start

**1. Mount the provider once, near the root of your app.** It hosts the camera
screen and the preview progress card.

```tsx
import {DocumentKitProvider} from 'react-native-document-kit';

export const App = () => (
  <DocumentKitProvider>
    <Root />
  </DocumentKitProvider>
);
```

**2. Use the hook anywhere below it.**

```tsx
import {Button} from 'react-native';
import {openAppSettings, useDocumentKit} from 'react-native-document-kit';

export const AttachPhotoButton = () => {
  const {capturePhoto, capturePhotoWithSystemCamera} = useDocumentKit();

  const attach = async () => {
    const result = await capturePhoto();
    switch (result.status) {
      case 'picked':
        await upload(result.files[0]); // {uri, name, mimeType, size, width, height, ...}
        break;
      case 'permission_denied':
        if (result.isBlocked) {
          await openAppSettings(); // the OS won't ask again; only Settings can grant it
        }
        break;
      case 'unavailable':
        // No usable camera in the app: hand over to the phone's camera app.
        await capturePhotoWithSystemCamera();
        break;
      case 'cancelled':
      case 'error': // result.code: 'busy' | 'capture_failed' | ...
        break;
    }
  };

  return <Button title="Take photo" onPress={attach} />;
};
```

## How results work

Every function resolves; none of them rejects. Each one returns an object with a
`status`. TypeScript narrows the rest of the object for each status.

| Function | Result type | Statuses |
|---|---|---|
| Camera, library, documents | `PickResult` | `picked`, `cancelled`, `permission_denied`, `unavailable`, `error` |
| `openPreview` | `PreviewResult` | `closed`, `opened_externally`, `unsupported`, `cancelled`, `busy`, `failed` |
| `downloadFile` | `DownloadResult` | `downloaded`, `cancelled`, `failed` |
| `saveToDevice` | `SaveToDeviceResult` | `saved`, `cancelled`, `failed` |

Some results include an `error` field. It is for your monitoring; never show it
to users. Unexpected errors are also sent to the provider's `onError`.

## API reference

### `<DocumentKitProvider>`

Mount it once, near the root of your app, inside whatever provides your theme
and translations. It renders the camera screen and the preview progress card
above your app.

| Prop | Type | Default | |
|---|---|---|---|
| `children` | `ReactNode` | | Your app |
| `theme` | `Partial<DocumentKitTheme>` | Built-in dark camera, blue accent | Colours and font. See [Theming](#theming) |
| `labels` | `Partial<DocumentKitLabels>` | English | Every text the screens show. See [Translations](#translations-labels) |
| `onError` | `(error, {operation}) => void` | none | Errors DocumentKit handled itself, for your monitoring |
| `onUnauthorized` | `({url, httpStatus}) => Promise<headers \| null>` | none | A server answered 401/403: return fresh headers to retry once. See [Expired sessions](#expired-sessions-401--403) |
| `onCameraTiming` | `(timing) => void` | none | Each camera step with its time since `openCamera`, for measuring speed |
| `cameraPrewarm` | `boolean` | `true` | Start the camera during the permission prompt and while the screen opens |

Keep `theme` and `labels` stable: define them outside the component, or wrap
them in `useMemo`. A new object on every render makes the screens rebuild
their styles each time.

### `useDocumentKit()`

Returns the API below. It must be called inside `<DocumentKitProvider>`, and
throws a clear error otherwise.

```ts
const {
  openCamera,
  capturePhoto,
  recordVideo,
  capturePhotoWithSystemCamera,
  recordVideoWithSystemCamera,
  pickFromLibrary,
  pickDocuments,
  prewarmCamera,
  openPreview,
} = useDocumentKit();
```

Every function is stable, so it is safe in dependency arrays.

### Camera

#### `openCamera(options?) → Promise<PickResult>`

Opens the full-screen in-app camera. It asks for camera permission and, for
video, the microphone.

- **Sound:** in video mode, a microphone switch lets the user record without
  sound. It is set before recording starts and kept across Retake.
- **No microphone permission:** video records without sound, the switch is
  hidden, and the screen says so.
- **Your app decides:** `video: {audio: false}` records without sound, never
  asks for the microphone, and hides the switch.
- **Torch:** in video mode, the flash button turns the torch on and off, also
  while recording.
- **Saving:** while a photo, or a stopped recording, is being saved, the
  preview stays frozen on the shot.
  - A thin bar slides along the top in `primaryColor`.
  - A "Saving photo…" / "Saving video…" pill sits above the shutter.
  - Both appear only if saving takes longer than 250 ms, so quick shots don't
    flash.

| Option | Type | Default | |
|---|---|---|---|
| `modes` | `('photo' \| 'video')[]` | `['photo']` | More than one shows the Photo / Video switch |
| `initialMode` | `'photo' \| 'video'` | first of `modes` | |
| `video.quality` | `'auto' \| 'low' \| 'medium' \| 'high'` | `'auto'` | 480p / 720p / 1080p. `'auto'` picks from the network |
| `video.maxDurationSeconds` | `number` | `0` (no limit) | Recording stops at the limit and keeps the file |
| `video.audio` | `boolean` | `true` | `false` records without sound and never asks for the microphone |
| `allowMultiple` | `boolean` | `false` | Several captures at once: the camera stays open after each one, with a thumbnail, the multi-capture review and Done |
| `maxFiles` | `number` | `10` with `allowMultiple`, else `1` | The most captures. A value above 1 alone also turns multiple captures on |
| `positions` | `('back' \| 'front')[]` | `['back', 'front']` | Cameras the user may use; one entry hides the front/back switch. If the device lacks the opening camera, the other allowed one is used |
| `initialPosition` | `'back' \| 'front'` | first of `positions` | Camera it opens on |
| `allowZoom` | `boolean` | `true` | Pinch zoom and the 0.5× / 1× / 2× lens buttons |
| `allowFlash` | `boolean` | `true` | Flash button (torch for video); `false` keeps the flash off |
| `review.enabled` | `boolean` | `true` | `false` skips the review screen: each capture is used as soon as it is saved |
| `review.header` | `boolean` | `true` | Close button, "Review photo" title, file name and size |
| `review.crop` | `boolean` | `true` | Photo editor: Crop tab |
| `review.straighten` | `boolean` | `true` | Photo editor: Straighten tab (−45° to 45°) |
| `review.rotate` | `boolean` | `true` | Photo editor: Left 90° / Right 90° |
| `review.flip` | `boolean` | `true` | Photo editor: Flip (mirror left to right) |
| `review.cropAspectRatios` | `CropAspectRatio[]` | `['free', '1:1', '4:3', '3:4', '16:9']` | Crop shapes offered; the first is selected. `['1:1']` forces square crops; `[]` crops free-form with no shape row |
| `review.remove` | `boolean` | `true` | Multi-capture: the delete button and the × on each thumbnail |
| `review.addMore` | `boolean` | `true` | Multi-capture: the "+" tile back to the camera (until `maxFiles`) |
| `review.reorder` | `boolean` | `true` | Multi-capture: hold a thumbnail and drag it to change the order |

```ts
// Selfie camera only: no switch, no zoom, no flash.
const selfie = await openCamera({positions: ['front'], allowZoom: false, allowFlash: false});

// Both cameras, starting on the front one.
const result1 = await openCamera({initialPosition: 'front'});

// Photo or video, starting on video, at most 60 s.
const result = await openCamera({
  modes: ['photo', 'video'],
  initialMode: 'video',
  video: {maxDurationSeconds: 60},
});

// Several photos in one go, up to 5.
const batch = await openCamera({allowMultiple: true, maxFiles: 5});
if (batch.status === 'picked') {
  console.log(batch.files.length); // 1–5
}
```

**Multi-capture** (`allowMultiple: true`). The camera stays open after each shot,
with a thumbnail and a count, and a Done button. Tapping the thumbnail, or
reaching `maxFiles`, opens the review:
- **The captures, full screen:** swipe between them, or tap a thumbnail.
- **Top:**
  - close: back to the camera; nothing is lost.
  - "Review photos" and "2 / 5" (`review.header`).
  - a Crop & Rotate button for the photo shown, opening the same editor as the
    single review.
  - Delete (`review.remove`).
- **Bottom sheet:**
  - the thumbnails, each with a × to remove it (`review.remove`). Hold one
    and drag it to change the order (`review.reorder`); the strip scrolls
    near its edges. Screen readers get "Move earlier" / "Move later" actions.
  - a "+" tile back to the camera, until `maxFiles` is reached
    (`review.addMore`).
  - "Attach 3 photos →".

Each photo keeps its own edits; they are written when the user attaches.
`files` come back in the order shown in the strip.
With `review: {enabled: false}`, reaching `maxFiles` attaches straight away.

**Review screen.** With `maxFiles: 1`, each capture shows a review screen. Every
part can be switched off with `review`, and all are on by default.
- **Header:** a close button (closes the camera), "Review photo" or "Review
  video", and the file's name and size.
- **Crop & Rotate:** a button that opens the photo editor: Cancel / Done at the
  top, the photo with its crop frame, and a tab for each tool.
  - **Crop:** drag a corner to resize the frame, or inside it to move it, over a
    rule-of-thirds grid. Shapes: Free, 1:1, 4:3, 3:4, 16:9 (your own list with
    `cropAspectRatios`). A fixed shape keeps the frame's proportions while
    dragging.
  - **Straighten:** drag the ruler to turn the photo up to 45° either way; it
    zooms in just enough that no empty corner shows. Tap the angle to reset.
  - **Rotate:** Left 90°, Right 90° and Flip. The crop turns and mirrors with
    the photo.
- **Buttons:** Retake, and Use Photo / Use Video. Recorded videos can be played
  first, and their size is shown next to the length, so users see what will
  upload.

Edits show at once on the screen-sized copy. They are applied to the
full-resolution photo only when the user taps **Use Photo**, and the result is a
new file; the original is kept:
- **Rotate and flip alone** only rewrite the photo's orientation, so nothing is
  re-compressed.
- **A crop** decodes just the cropped region, so even 50 MP photos don't run
  out of memory.
- **Straighten** redraws the pixels, from a copy of at most about 16 MP.

```ts
// Square crops only, no straighten.
openCamera({review: {cropAspectRatios: ['1:1'], straighten: false}});
// No editing at all, header kept; or skip the review completely.
openCamera({review: {crop: false, straighten: false, rotate: false, flip: false}});
capturePhoto(); // all review parts on
openCamera({modes: ['video'], review: {enabled: false}});
```

**Automatic video quality.** `'auto'` reads the network when the camera opens:

| Network | Quality |
|---|---|
| Data saver / Low Data Mode, or offline | low (480p, about 7.5 MB/min) |
| Upload speed ≥ 10 Mbps (Android estimate) | high (1080p, about 45 MB/min) |
| Upload speed ≥ 2 Mbps | medium (720p, about 19 MB/min) |
| Wi-Fi / Ethernet (unknown speed) | high, or medium when metered |
| 5G / 4G | medium |
| 3G / 2G | low |

#### `capturePhoto(options?) → Promise<PickResult>`

`openCamera` locked to photos. It takes `openCamera`'s other options:
`allowMultiple`, `maxFiles`, `review`, `positions`, `initialPosition`,
`allowZoom`, `allowFlash`.

```ts
capturePhoto();                                        // one photo
capturePhoto({allowMultiple: true});                   // several (up to 10), with the multi-capture review
capturePhoto({allowMultiple: true, maxFiles: 5});      // several, up to 5
capturePhoto({positions: ['front'], review: {enabled: false}});
```

#### `recordVideo(options?) → Promise<PickResult>`

`openCamera` locked to video. Options: `quality`, `maxDurationSeconds` and `audio`, plus the
same camera options as `capturePhoto` (e.g. `recordVideo({maxDurationSeconds: 30, maxFiles: 3})`).

#### `capturePhotoWithSystemCamera()` / `recordVideoWithSystemCamera(options?)`

These open the phone's own camera app. Use them when the in-app camera resolves
`unavailable`, or when you prefer the system UI. Video always arrives as MP4.
The Android camera app only tells low quality apart from medium/high.

#### `prewarmCamera() → void`

Optional. Call it when a screen with a camera button appears, so the camera
opens faster. It never shows a prompt, and does nothing until the user has
granted camera permission. `openCamera` already pre-warms on its own.

```ts
useEffect(() => {
  prewarmCamera();
}, [prewarmCamera]);
```

### Photo library and documents

#### `pickFromLibrary(options?) → Promise<PickResult>`

The system photo picker. It needs no permission on either platform.

| Option | Type | Default | |
|---|---|---|---|
| `mediaType` | `'photo' \| 'video' \| 'mixed'` | `'mixed'` | |
| `allowMultiple` | `boolean` | `false` | Several items in one pick |
| `selectionLimit` | `number` | `1`, or no limit with `allowMultiple` | The most items; `0` means no limit. A value above 1 alone also allows several |
| `review` | `boolean \| CameraReviewOptions` | off | Shows the camera's review after picking photos (see below) |

On iOS, HEIC photos arrive as JPEG and videos as MP4.

**Review after picking.** `review: true` (or review options) shows the camera's
review screens for the picked photos. Every part is on unless switched off,
exactly as for the camera:
- **One photo** (`selectionLimit: 1`): Crop & Rotate, and **Choose another**
  (opens the picker again) instead of Retake.
- **Several:**
  - the multi-photo review: crop, delete and reorder.
  - "+" picks more, up to `selectionLimit`.
  - "Attach 3 photos".

Edited photos come back as new JPEG copies with the picked name; untouched ones
come back as picked. A pick that includes a video or a GIF skips the review.

```ts
pickFromLibrary({allowMultiple: true, selectionLimit: 5, review: true});
pickFromLibrary({review: {cropAspectRatios: ['1:1'], straighten: false}}); // square avatar
```

#### `pickDocuments(options?) → Promise<PickResult>`

The Files app on iOS, or the system file picker on Android. It needs no permission.

| Option | Type | Default | |
|---|---|---|---|
| `mimeTypes` | `string[]` | every type | Wildcards allowed, e.g. `['application/pdf', 'image/*']` |
| `allowMultiple` | `boolean` | `false` | |

Original file names are kept. Cloud files (iCloud, Google Drive) are downloaded
before the result is returned.

### Preview

#### `openPreview(source, options?) → Promise<PreviewResult>`

Opens a file in a full-screen, in-app viewer, and resolves when the viewer closes.

- **Video and audio** stream straight away, without downloading.
- **Other remote files** download into DocumentKit's private cache first, never
  into the user's files. A cancellable progress card appears only if a download
  is actually needed; cached files open at once.

```ts
const {openPreview} = useDocumentKit();

const result = await openPreview(
  {
    uri: 'https://example.com/files/42',  // or file:// / content://
    name: 'Invoice.pdf',                   // viewer title; its extension picks the viewer
    mimeType: 'application/pdf',           // optional; guessed from the name
    headers: {Authorization: `Bearer ${token}`},
    cacheKey: 'invoice-42',                // shared with downloadFile
    forceRefresh: false,                   // true: download again even if cached
  },
  {
    save: {subdirectory: 'MyApp'},         // optional Save button (Android viewers)
    muted: false,                          // video/audio: true starts without sound
  },
);

if (result.status === 'failed') {
  showToast(result.reason === 'download' ? 'Could not download' : 'Could not open');
}
```

| Status | Meaning |
|---|---|
| `closed` | Shown in the app and closed by the user |
| `opened_externally` | Android only: handed to another app (e.g. Office files) |
| `unsupported` | Nothing on the device can open this type |
| `cancelled` | The user cancelled the download |
| `busy` | Another DocumentKit screen is open |
| `failed` | `reason: 'download' \| 'viewer' \| 'unauthorized'`, plus `httpStatus` and `error` for monitoring |

| Type | Android | iOS |
|---|---|---|
| PDF | Built-in viewer (zoom, page indicator) | QuickLook |
| Images | Built-in viewer (zoom, EXIF orientation, HEIC/WebP, GIF) | QuickLook |
| Text, CSV, HTML | Built-in viewers | QuickLook |
| Video / audio | DocumentKit's player (Media3), streamed | DocumentKit's player (AVPlayer), streamed |
| Office, iWork | "Open with" another app | QuickLook |

**Save button.** `save: {subdirectory, notification?}` adds a Save button to
Android's image and PDF viewers. It saves to `Download/<subdirectory>` without
leaving the viewer. iOS QuickLook already has Save to Files in its share button,
so the option is ignored there.

**Video and audio player.** Both platforms use DocumentKit's own player, with
the same design:
- **Top:** close, the title with its length and size (size for local files),
  and Download when you pass `save`.
- **Centre:** back 5 s, play / pause (a spinner while buffering), forward 15 s.
- **Bottom:** elapsed and remaining time, and a seek bar in your `primaryColor`
  that shows what has buffered.
- **Bottom row:**
  - **Speed:** cycles 0.5× to 2×.
  - **Sound:** turns the sound on and off. `muted: true` starts without sound.
  - **Full screen:** a landscape video turns the screen to landscape (where
    the app allows it); a portrait video fills the screen.
- **Hiding:** the controls hide after 3 s of playback; a tap shows them again.

**Player options.** `player` turns parts off; all are on by default:

```ts
openPreview(video, {
  player: {
    autoPlay: false,          // default true: opens paused, controls showing
    skipBackSeconds: 10,      // default 5; 0 hides the button
    skipForwardSeconds: 30,   // default 15; 0 hides the button
    allowSpeed: false,        // the 0.5×–2× button
    allowFullScreen: false,   // the full-screen button
  },
});
```

**Download** saves the video, streaming it first if needed, with the same
headers:
- **Android:** to `Download/<subdirectory>`.
- **iOS:** through the Save to Files sheet.

The same player plays recordings on the camera's review screen, without
Download.

**Without the provider.** `openPreview` is also exported on its own, for code
outside React. That version shows no progress card and has no busy guard.
Instead it accepts `labels`, `onProgress`, `signal` (an `AbortSignal`), `muted`,
`accentColor` (the player's seek bar) and `save`:

```ts
import {openPreview} from 'react-native-document-kit';

const controller = new AbortController();
await openPreview(source, {onProgress: ({fraction}) => setProgress(fraction), signal: controller.signal});
```

### Download, save and cache

These are plain functions and don't need the provider.

#### `downloadFile(request) → Promise<DownloadResult>`

```ts
import {downloadFile} from 'react-native-document-kit';

const controller = new AbortController();
const result = await downloadFile({
  url: 'https://example.com/files/42',
  fileName: 'Invoice.pdf',
  cacheKey: 'invoice-42',            // same key → served from cache, no request
  headers: {Authorization: `Bearer ${token}`},
  onProgress: ({fraction}) => setProgress(fraction), // fraction is null when the size is unknown
  signal: controller.signal,         // controller.abort() cancels
  notification: {tag: 'invoice-42', title: 'Invoice.pdf'}, // Android, optional
});

switch (result.status) {
  case 'downloaded':
    console.log(result.file.uri, result.file.fromCache);
    break;
  case 'failed':
    // result.reason: 'network' | 'http' | 'unauthorized' | 'storage'; result.httpStatus for 'http' and 'unauthorized'
    break;
  case 'cancelled':
    break;
}
```

| Field | Type | |
|---|---|---|
| `url` | `string` | Complete URL |
| `fileName` | `string` | Name of the cached copy |
| `cacheKey` | `string` | Defaults to the URL. Use something like `"<account>:<documentId>"` when URLs are signed or change |
| `headers` | `Record<string, string>` | |
| `onProgress` | `({bytesWritten, totalBytes, fraction}) => void` | |
| `signal` | `AbortSignal` | Cancels for this caller. The transfer stops only when no other caller is waiting for it |
| `forceRefresh` | `boolean` | Defaults to `false`. `true` ignores (and replaces) the cached copy and any partial download, for files that may have changed on the server |
| `notification` | `DownloadNotification` | Android progress, then "Downloaded" notification. Asks for notification permission once, in context. Ignored on iOS |
| `onUnauthorized` | `UnauthorizedHandler` | On 401/403, fresh headers to retry once. Defaults to the provider's `onUnauthorized` |

How downloads behave:

- **Cache:** 200 MB, with the least recently used files removed first.
- **Retries:** up to 4 attempts with backoff.
- **Resume:** an interrupted download carries on where it stopped, if the
  server supports `Range` requests.
- **Timeout:** only after 60 s with no data, so slow networks still finish.
- **Shared transfers:** callers asking for the same `cacheKey` at the same time
  share one transfer.

#### `saveToDevice(file, options?) → Promise<SaveToDeviceResult>`

```ts
import {saveToDevice} from 'react-native-document-kit';

const saved = await saveToDevice(
  {uri: result.file.uri, name: 'Invoice.pdf', mimeType: 'application/pdf'},
  {subdirectory: 'MyApp', notification: {tag: 'invoice-42', title: 'Invoice.pdf'}},
);
// saved.status: 'saved' (with location) | 'cancelled' (iOS sheet closed) | 'failed'
```

- **Android** copies the file to `Download/<subdirectory>` with no permission
  prompt. With `notification`, it shows "Downloaded", and tapping it opens the file.
- **iOS** shows the Save to Files sheet so the user picks the folder.

#### `clearDownloadCache() → Promise<void>`

Deletes every cached download, for example on logout.

### `openAppSettings()`

Opens your app's page in the system Settings. Use it when a result has
`permission_denied` with `isBlocked: true`.

### Types

```ts
interface PickedFile {
  uri: string;          // always file://, in your app's cache
  name: string;         // "Image_1700000000000.jpg"
  baseName: string;     // "Image_1700000000000"
  extension: string;    // "jpg" (lowercase, no dot)
  mimeType: string;
  size: number;         // bytes; 0 if unknown
  width?: number;
  height?: number;
  durationMs?: number;  // videos
  source: 'camera_photo' | 'camera_video' | 'library' | 'documents';
}

type PickResult =
  | {status: 'picked'; files: PickedFile[]}
  | {status: 'cancelled'}
  | {status: 'permission_denied'; isBlocked: boolean} // isBlocked: only Settings can grant it
  | {status: 'unavailable'; reason: 'no_camera_device'}
  | {status: 'error'; code: 'busy' | 'permission_check_failed' | 'capture_failed' | 'pick_failed'};

type DownloadResult =
  | {status: 'downloaded'; file: {uri: string; name: string; mimeType: string; size: number; fromCache: boolean}}
  | {status: 'cancelled'}
  | {status: 'failed'; reason: 'network' | 'http' | 'unauthorized' | 'storage'; httpStatus?: number; error: unknown};

type SaveToDeviceResult =
  | {status: 'saved'; location: string}
  | {status: 'cancelled'}
  | {status: 'failed'; error: unknown};

interface DownloadNotification {
  tag: string;            // same tag for download and save, so one notification updates
  title: string;          // usually the file name
  channelName?: string;   // default "Downloads"
  downloading?: string;   // default "Downloading…"
  downloaded?: string;    // default "Downloaded"
  close?: string;         // default "Close" (viewer opened from the notification)
}
```

Every type is exported from the package root. That includes `DocumentKitApi`,
`OpenCameraOptions`, `OpenPreviewOptions`, `RecordVideoOptions`, `PickFromLibraryOptions`,
`PickDocumentsOptions`, `PreviewSource`, `PreviewResult`, `DownloadRequest`,
`DocumentKitTheme`, `DocumentKitLabels` and the others.

## Expired sessions (401 / 403)

DocumentKit's native code does its own HTTP requests: document downloads, the
download before a preview, and video streams. They send exactly the headers you
pass. If your session cookie has changed since then (your API client follows the
server's `Set-Cookie`, but the copy you pass to DocumentKit does not), the server
answers 401, and without handling the user just sees "can't preview".

Give the provider `onUnauthorized` once. On a 401 or 403 from any DocumentKit
request, it is called, and the request is retried once with the headers it
returns:

```tsx
<DocumentKitProvider
  onUnauthorized={async ({url, httpStatus}) => {
    const cookie = await getCurrentSessionCookie(); // or refresh the session
    return cookie ? {Cookie: cookie} : null;        // null: give up
  }}>
```

- **Downloads and document previews** retry the download with the new headers
  (they replace same-named headers, whatever their case).
- **Video and audio** close the player when the server answers 401/403, then
  reopen it with the new headers where it stopped. The user sees a short flash,
  not an error.
- **Shared refresh:** several requests to the same server failing together share
  one `onUnauthorized` call.
- **Giving up:** when it returns `null`, throws (reported to `onError` as
  `session_refresh`), or the retry is refused again, the call resolves
  `{status: 'failed', reason: 'unauthorized', httpStatus}`. Show "Your session
  expired, please sign in again" there instead of a generic failure:

```ts
const result = await openPreview(source);
if (result.status === 'failed' && result.reason === 'unauthorized') {
  signInAgain();
}
```

`downloadFile` and the standalone `openPreview` use the provider's handler too,
or accept their own `onUnauthorized`. A 403 is included because many servers
answer it for an expired session; check `httpStatus` if yours uses 403 only for
"no access".

## Recipes

### Upload a picked file

`PickedFile` matches what `fetch` and `FormData` expect in React Native.

```ts
const result = await pickDocuments({mimeTypes: ['application/pdf'], allowMultiple: true});
if (result.status === 'picked') {
  const form = new FormData();
  for (const file of result.files) {
    form.append('files', {uri: file.uri, name: file.name, type: file.mimeType} as any);
  }
  await fetch('https://example.com/upload', {method: 'POST', body: form});
}
```

### One "Attach" button with every source

```ts
const {openCamera, pickFromLibrary, pickDocuments} = useDocumentKit();

const sources = {
  camera: () => openCamera({modes: ['photo', 'video'], maxFiles: 10}),
  gallery: () => pickFromLibrary({allowMultiple: true, selectionLimit: 10}),
  files: () => pickDocuments({allowMultiple: true}),
};

const attach = async (from: keyof typeof sources) => {
  const result = await sources[from]();
  if (result.status === 'picked') {
    addAttachments(result.files); // same shape from every source
  }
};
```

### Handle a blocked permission

```ts
const result = await recordVideo();
if (result.status === 'permission_denied') {
  Alert.alert('Camera access', 'Allow camera access to record videos.', [
    {text: 'Not now', style: 'cancel'},
    ...(result.isBlocked ? [{text: 'Open Settings', onPress: () => openAppSettings()}] : []),
  ]);
}
```

### Download with a progress bar, then save

```ts
const [progress, setProgress] = useState<number | null>(null);

const download = async () => {
  const result = await downloadFile({
    url,
    fileName: 'Report.pdf',
    cacheKey: `report-${id}`,
    onProgress: ({fraction}) => setProgress(fraction),
  });
  setProgress(null);
  if (result.status === 'downloaded') {
    await saveToDevice({uri: result.file.uri, name: 'Report.pdf', mimeType: result.file.mimeType});
  }
};
```

### Preview from a list (cached after the first open)

```ts
const open = (doc: Doc) =>
  openPreview({uri: doc.url, name: doc.fileName, cacheKey: `doc-${doc.id}`, headers: authHeaders});
```

### Clear files on logout

```ts
await clearDownloadCache();
```

## Theming

Pass any subset of `DocumentKitTheme`; anything you leave out keeps its
default. Define the theme outside your component so it stays the same object
between renders.

```tsx
const theme = {
  primaryColor: '#7C3AED',
  onPrimaryColor: '#FFFFFF',
  recordColor: '#F43F5E',
  fontFamily: 'Inter-SemiBold',
};

<DocumentKitProvider theme={theme}>
```

| Key | Default | Used for |
|---|---|---|
| `primaryColor` | `#1C6FE2` | Use / Retake buttons, active mode, Done, count badge, preview progress and Cancel, the video player's seek bar |
| `onPrimaryColor` | `#FFFFFF` | Text and spinners on `primaryColor` |
| `iconColor` | `#FFFFFF` | Close, flash, switch-camera, play/pause and remove icons; thumbnail border |
| `textColor` | `#FFFFFF` | Timer, mode names, lens zoom, notices, durations, review title, loading spinner |
| `backgroundColor` | `#000000` | Camera and review screens, review button bar |
| `overlayColor` | `rgba(0, 0, 0, 0.55)` | Translucent pills over the preview (timer, modes, lens zoom, notices, remove) |
| `shutterColor` | `#FFFFFF` | Shutter ring and photo shutter |
| `recordColor` | `#E5383B` | Record and stop buttons, recording dot |
| `activeZoomColor` | `#FFD60A` | The selected lens's zoom |
| `surfaceColor` | `#1A1A1A` | Multi-capture tiles while loading |
| `playButtonColor` | `rgba(255, 255, 255, 0.18)` | Play button on a recorded video |
| `posterScrimColor` | `rgba(0, 0, 0, 0.35)` | Dims a recording's first frame on review |
| `toastColor` | `rgba(28, 37, 65, 0.92)` | The "Saving photo…" pill shown while a capture is saved |
| `outlineColor` | `rgba(255, 255, 255, 0.35)` | Border of the review screens' Retake / Add more button |
| `fontFamily` | system | Every text DocumentKit draws in JS |
| `previewBackdropColor` | `rgba(0, 0, 0, 0.45)` | Behind the "Opening file…" card |
| `previewCardColor` | `#FFFFFF` | The "Opening file…" card |
| `previewTitleColor` | `#111827` | "Opening file…" |
| `previewTextColor` | `#6B7280` | The file name on that card |
| `previewTrackColor` | `#E5E7EB` | Unfilled part of its progress bar |

The video player follows `primaryColor`. The document viewers keep their
platform look: Android's PDF, image and text screens, and iOS QuickLook.

## Translations (labels)

Pass any subset of `DocumentKitLabels`; anything you leave out stays in English.
Labels marked *a11y* are read by screen readers and aren't shown on screen.

```tsx
<DocumentKitProvider labels={{retake: 'Reprendre', usePhoto: 'Utiliser la photo', done: 'Terminé'}}>
```

| Key | Default |
|---|---|
| `takePhoto` *a11y* | Take photo |
| `retake` | Retake |
| `usePhoto` | Use Photo |
| `useVideo` | Use Video |
| `close` *a11y* | Close camera |
| `toggleFlash` *a11y* | Toggle flash |
| `flashOff` / `flashOn` / `flashAuto` *a11y* | Off / On / Auto |
| `switchCamera` *a11y* | Switch camera |
| `photoMode` / `videoMode` | Photo / Video |
| `startRecording` / `stopRecording` *a11y* | Start recording / Stop recording |
| `pauseRecording` / `resumeRecording` *a11y* | Pause recording / Resume recording |
| `playVideo` *a11y* | Play video |
| `recordingWithoutSound` | Recording without sound |
| `recordSound` *a11y* | Record sound (the microphone switch; read out as on/off) |
| `cameraPausedMultitasking` | The camera is paused while other apps share the screen (iPad Split View / Slide Over) |
| `cameraInUse` | Another app is using the camera |
| `cameraPaused` | The camera is paused (other system pauses) |
| `savingPhoto` / `savingVideo` | Saving photo… / Saving video… (shown while a capture is saved) |
| `reviewPhoto` / `reviewVideo` | Review photo / Review video |
| `editPhoto` | Crop & Rotate (the review screen's button) |
| `cropCancel` | Cancel (photo editor; Done uses `done`) |
| `crop` / `straighten` / `rotate` | Crop / Straighten / Rotate (editor tabs) |
| `rotateLeft` / `rotateRight` / `flip` | Left 90° / Right 90° / Flip |
| `cropFree` | Free (the free-form crop shape) |
| `editFailed` | Could not edit the photo. Try again. |
| `done` | Done (shown as "Done (3)") |
| `reviewPhotos` / `reviewVideos` / `reviewCaptures` | Review photos / Review videos / Review captures (multi-capture title) |
| `addMore` *a11y* | Add more (the "+" tile) |
| `backToCamera` *a11y* | Back to camera (multi-capture close button) |
| `closeReview` *a11y* | Close (library review close button) |
| `chooseAnother` | Choose another (library review of one photo, instead of Retake) |
| `removeCapture` / `deleteCapture` *a11y* | Remove (thumbnail ×) / Delete (top button) |
| `moveEarlier` / `moveLater` *a11y* | Move earlier / Move later (thumbnail actions) |
| `attachPhoto` / `attachPhotos` | Attach 1 photo / Attach {count} photos |
| `attachVideo` / `attachVideos` | Attach 1 video / Attach {count} videos |
| `attachFiles` | Attach {count} files (photos and videos together) |
| `preparingPreview` | Opening file… |
| `cancel` | Cancel |
| `previewClose` *a11y* | Close |
| `playbackError` | This file cannot be played. |
| `previewSave` | Save |
| `previewSaved` | Saved to Downloads |
| `previewSaveFailed` | Could not save the file |
| `previewTruncated` | This file is large, so only its beginning is shown. |
| `previewMute` / `previewUnmute` *a11y* | Mute / Unmute (the player's sound button) |
| `previewPlay` / `previewPause` *a11y* | Play / Pause |
| `previewSeekBack` / `previewSeekForward` *a11y* | Back {seconds} seconds / Forward {seconds} seconds ({seconds} is filled in) |
| `previewPlaybackSpeed` *a11y* | Playback speed (read with the speed, e.g. "Playback speed, 1.5x") |
| `previewFullScreen` / `previewExitFullScreen` *a11y* | Full screen / Exit full screen |

Download notification text is passed per call, in `notification` (see
[`DownloadNotification`](#types)).

## Monitoring and speed

```tsx
<DocumentKitProvider
  onError={(error, {operation}) => Sentry.captureException(error, {tags: {operation}})}
  onCameraTiming={({mark, elapsedMs}) => analytics.track('camera_timing', {mark, elapsedMs})}>
```

- **`onError`** receives errors DocumentKit handled itself. `operation` is one of
  `camera_permission`, `camera_prewarm`, `camera_capture`,
  `system_camera_capture`, `library_pick`, `document_pick`,
  `microphone_permission`, `network_read`, `video_recording`,
  `session_refresh` (your `onUnauthorized` threw) or `photo_edit` (a crop or
  rotation could not be saved). Expected
  outcomes (cancel, denied, network failures) are not reported here; they come
  back in the result.
- **`onCameraTiming`** marks each step of a camera session, in milliseconds
  since `openCamera` was called: `open`, `permissions_done`, `prewarm_done`,
  `screen_shown`, `preview_started`, `switch_camera`, `shutter`,
  `capture_done`, `confirm`, `result_ready`.

## Platform notes

- **Android 15 and 16:** the camera draws edge to edge, under the system bars.
  Controls stay clear of cutouts and gesture areas.
- **Rotation:** photos and videos are saved the right way up for how the
  device is held, even with rotation lock on.
  - If your app stays in portrait, the camera icons turn to follow the phone.
  - If your app rotates (iPad, tablets, apps that allow landscape), the
    preview and the controls turn with the screen.
- **Process death (Android):** if Android kills the app while the system camera
  or a system picker is open, that pick is lost and the user picks again.
- **Storage:** returned files live in `cacheDir/document-kit` (Android) or
  `Caches/document-kit` (iOS). The OS can clear caches under storage pressure,
  so upload or move files you need to keep.

## Troubleshooting

| Problem | Fix |
|---|---|
| `useDocumentKit must be used inside <DocumentKitProvider>` | Mount the provider above every screen that uses the hook |
| iOS app closes the moment the camera opens | Add `NSCameraUsageDescription` (and `NSMicrophoneUsageDescription` for video) to `Info.plist` |
| `TurboModuleRegistry.getEnforcing(...): 'DocumentKit…' could not be found` | Rebuild the app after installing (`pod install` on iOS), and make sure the New Architecture is enabled |
| Every call resolves `error` / `busy` | Another DocumentKit screen is still open, or a call is still running. Await each call before starting the next |
| `unavailable` from the in-app camera | No usable camera (e.g. a simulator), or the app binary was built before DocumentKit was added. Fall back to `capturePhotoWithSystemCamera()` |
| Gradle: duplicate or conflicting CameraX classes | Set `documentKitCameraXVersion` (see [CameraX version](#android-camerax-version)) |
| Videos have no sound | The user turned the microphone switch off, `video.audio` is `false`, microphone permission was denied, or `RECORD_AUDIO` was removed from the manifest |

## Known limitations

- **iPad multitasking:** in Split View, Slide Over or Stage Manager, iOS pauses
  the camera until the app is full screen again. The camera says so ("The
  camera is paused while other apps share the screen") and holds the shutter
  meanwhile. The same happens on both platforms while a call or another app
  has the camera.
- **Android PDF viewer:** no text search or text selection.
- **Office files on Android:** opened in another app ("Open with").
- **iOS streamed previews:** send only the `Cookie` header, not other headers.
- **iOS pause / resume while recording:** records separate segments joined at
  the end, so there can be a gap of a few frames at each pause.

## Development

```sh
npm install
npm run lint
npm run typescript
npm run build        # bob → lib/module and lib/typescript
```

To work on the library inside an app:

1. Depend on it with `"react-native-document-kit": "link:../react-native-document-kit"`.
2. Run your package manager's install, then `pod install`.
3. Make Metro watch the library's folder (`watchFolders`), while resolving
   `react` and `react-native` from the app only.

JS changes reload live. Native changes need a rebuild, and spec changes also
need `pod install` again.

After editing `src/specs/DocumentKitCameraViewNativeComponent.ts`, reload the
app fully (`r` in Metro). Fast Refresh re-runs that file, and React Native then
stops with *"Tried to register two views with the same name
DocumentKitCameraView"*. Apps using the published package never re-run it.

Design notes and decisions: [docs/DESIGN.md](docs/DESIGN.md). Camera design
and speed budgets: [docs/CAMERA_PLAN.md](docs/CAMERA_PLAN.md).

## Publishing

Checklist for maintainers:

1. Fill in `author`, `homepage`, `repository` and `bugs` in `package.json`. The
   iOS podspec reads its `source` and `homepage` from these fields.
2. Add a `LICENSE` file (MIT) with the copyright holder.
3. Run the checks and build:
   ```sh
   npm run lint && npm run typescript && npm run build
   ```
4. See exactly what will ship:
   ```sh
   npm pack --dry-run
   ```
5. Test the packed tarball in a fresh app on a real Android device and a real
   iPhone/iPad, using `npm pack` and `npm install ../react-native-document-kit-x.y.z.tgz`.
6. Log in and publish:
   ```sh
   npm login
   npm version <patch|minor|major>   # updates package.json and makes a git tag
   npm publish                       # runs bob build first
   ```
   While on 0.x, consider `npm publish --tag next` until the first stable release.
7. Push the tag (`git push --follow-tags`). The podspec expects a `v<version>`
   tag in the repository.

## License

MIT
