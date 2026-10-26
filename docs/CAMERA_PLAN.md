# react-native-document-kit: own in-app camera (photo + video)

Plan to replace `react-native-vision-camera` with DocumentKit's own camera
(CameraX on Android, AVFoundation on iOS), make it **faster** than today's
camera, redesign the screen around current capture patterns, and drop
`react-native-vision-camera`, `react-native-blob-util` and `react-native-svg`
from DocumentKit.

Roadmap item 4 in [DESIGN.md](DESIGN.md#8-status-and-roadmap). Written October 2026.

## Contents

1. [Why and scope](#1-why-and-scope)
2. [What stays the same](#2-what-stays-the-same)
3. [Speed](#3-speed)
4. [UI flow](#4-ui-flow)
5. [Architecture](#5-architecture)
6. [Android: CameraX](#6-android-camerax)
7. [iOS: AVFoundation](#7-ios-avfoundation)
8. [Phases](#8-phases)
9. [Testing](#9-testing)
10. [Risks](#10-risks)
11. [Decisions to confirm](#11-decisions-to-confirm)

---

## 1. Why and scope

| | Today | After |
|---|---|---|
| Viewfinder, photo, video | `react-native-vision-camera` 4.7.3 (no 4.x release since Nov 2025; v5 is a breaking rewrite on Nitro) | DocumentKit native view + TurboModule |
| Captured file size | `react-native-blob-util` | Returned by the native capture call |
| Icons | `react-native-svg` | Bundled PNGs tinted with `tintColor` |

**In scope:** photo and video capture, speed targets, the new camera UI,
multi-capture, removing the three libraries from DocumentKit.

**Out of scope (later, see phases 9–10):** the app's QR/barcode scanner
(`the host app's code scanner`) and document scanning.
Until the scanner moves, **the app still ships vision-camera** even after
DocumentKit drops it.

## 2. What stays the same

- Public API: `openCamera`, `capturePhoto`, `recordVideo` and `PickResult`.
  `FilePicker.tsx` keeps working unchanged. New options are additive.
- `DocumentKitProvider` hosts the one camera modal; the busy guard, permission
  flow (`ensureCameraPermission`, `ensureMicrophonePermission`) and network
  quality tiers (`detectRecordingQuality`, `VIDEO_SETTINGS`) are reused.
- MP4 / H.264 output, 1080p / 720p / 480p tiers, video without sound when the
  microphone is refused, `maxDurationSeconds`.
- Video review plays through `NativeDocumentKitPreview.playMedia`.
- OS camera fallback (`capturePhotoWithSystemCamera`,
  `recordVideoWithSystemCamera`) when no camera device is available.

## 3. Speed

The camera must feel instant, including on low-end Android phones. Speed is
a release gate: the native camera does not replace vision-camera until it
meets these budgets **and** beats vision-camera's measured numbers on the
same devices.

### 3.1 Budgets

Measured from the user's tap, on the low-end test device (Android 10,
2–3 GB RAM) and iPhone SE. Mid-range and newer devices should be well under.

| Moment | Budget | What the user sees |
|---|---|---|
| Tap camera → first live frame (permission already granted) | ≤ 600 ms (≤ 400 ms mid-range) | Screen opens, preview fades in; no black hold |
| Photo ↔ Video switch | ≤ 300 ms | No preview blackout |
| Front ↔ back switch | ≤ 500 ms | Short crossfade from the last frame |
| Shutter → review shown (photo) | ≤ 300 ms | Captured frame appears at once; full file finishes in the background |
| Shutter → camera ready again (multi-capture) | ≤ 500 ms | Can take the next photo straight away |
| Record tap → recording started | ≤ 300 ms | Timer starts |
| Stop → review shown (video) | ≤ 500 ms | Poster frame and duration at once |
| Use Photo → result resolved | ≤ 200 ms | Modal closes |
| Use Video → result resolved | ≤ 1 s for a 1-minute 720p clip | Usually already done while the user reviewed |
| Close → camera released | ≤ 300 ms | Camera off (indicator light goes out) |
| Pinch zoom / UI animations | 60 fps, no dropped frames from JS | Smooth |

### 3.2 How

**Opening**

- **Parallel start-up.** Today `openCamera` awaits the microphone prompt and
  then the network check in sequence before the modal opens. Run the network
  check, the microphone check and the camera warm-up together
  (`Promise.all`), and open the modal as soon as camera permission is
  granted. *(This JS fix helps the current camera too; do it first.)*
- **Pre-warm.** `DocumentKitCamera.prewarm()` initialises the camera provider
  (Android `ProcessCameraProvider`, which is slow on first use) and builds the
  session off the main thread. DocumentKit calls it on its own while the
  permission prompt or the modal animation is running; the app may also call
  it when a screen with a camera button appears. It never runs at app start.
- **Session set up during the modal animation**, not after it. Preview fades
  in on the first real frame (`onPreviewStarted`), so there is no black or
  stretched frame.
- **Shorter open animation.** Fade (about 150 ms) instead of the current
  slide, like system cameras.

**Switching**

- **All outputs bound once.** Preview + photo + video are attached together
  when the device supports it, so Photo ↔ Video only changes a setting instead
  of rebuilding the session. Fallback: rebind (slower) on devices that
  cannot run all three.
- **Front/back switch** shows a blurred last frame while the other camera
  starts.

**Capturing**

- **Latency-first photo mode.** Android `CAPTURE_MODE_MINIMIZE_LATENCY`
  (`ZERO_SHUTTER_LAG` where CameraX reports support). iOS
  `photoQualityPrioritization = .balanced`, plus responsive and fast capture
  on iOS 17+. Full-resolution photos still; only the processing pipeline is
  faster.
- **Instant review.** The review shows a screen-sized frame immediately (the
  last preview frame on Android, the embedded preview image on iOS) while the
  full JPEG is written in the background. "Use Photo" waits only if writing
  is still running.
- **Screen-sized display copies.** Native returns a `previewUri`
  (screen-sized JPEG) next to the full file. Review, thumbnails and the
  multi-capture tray never decode a 12–50 MP photo in React Native, which is
  slow and can run low-end phones out of memory.
- **Video finalised during review.** On iOS, joining pause segments and the
  MP4 re-wrap happen in one passthrough export that starts the moment the user
  taps stop. The review screen shows the poster frame at once; usually the
  export is finished before "Use Video" is tapped.
- **Poster frame** from a small thumbnail extract (`AVAssetImageGenerator` /
  `MediaMetadataRetriever` at screen size), not a full frame decode.

**Smoothness**

- **Nothing per frame crosses to JS.** Pinch zoom and tap focus are handled
  by the native view; JS only gets throttled `onZoomChanged` events for the
  label. The recording timer comes from native progress events (once a
  second).
- **Animations on the native driver** (`Animated` with `useNativeDriver`):
  shutter morph, mode swipe, fades. No new animation library.
- **All file work off the main thread** on both platforms: saving, EXIF,
  thumbnails, size, export.
- **30 fps video**, no 60 fps, to keep phones cool and files small.

**Releasing**

- Closing stops the session at once (unbind / `stopRunning` on the session
  queue) and frees preview frames and thumbnails, so the rest of the app is
  not slowed by a camera still running.

### 3.3 Measuring

- Native timing marks for each moment in 3.1 (open, first frame, capture,
  file written, export done, released), sent as a dev-only event and logged
  in `__DEV__`.
- **Baseline first:** phase 0 measures today's vision-camera screen on the
  test devices with the same marks, so "faster" is a number, not a feeling.
- Phase 7 compares both engines on every test device; any budget missed
  blocks the switch-over.

## 4. UI flow

Modelled on the iOS and Android system cameras and on capture screens in
messaging and work apps (WhatsApp, Slack, Teams), which users already know.

### 4.1 Viewfinder

```
┌──────────────────────────────┐
│ ✕                  ⚡︎auto    │  close · flash (off → auto → on)
│           ● 00:12            │  recording pill (video, while recording)
│                              │
│            [ ]               │  tap-to-focus square + exposure slider
│                              │
│                              │
│      .5×   [1×]   2×         │  lens / zoom pills (only lenses that exist)
│      PHOTO   VIDEO           │  swipeable mode switch
│ [▣]        (  ◯  )       ⟲   │  last-capture thumbnail · shutter · switch camera
└──────────────────────────────┘
```

| Element | Behaviour | Change from today |
|---|---|---|
| Mode switch | Swipe left/right on the preview or tap the label; hidden while recording; instant (§3.2) | Today: tap-only segmented pill |
| Shutter | Photo: white circle. Video: red circle → morphs to a red rounded square while recording | Same idea, animated |
| Zoom | Pinch, plus pills for the lenses the device has (0.5× ultra-wide, 1×, 2×/telephoto); current zoom shown while pinching | New pills |
| Focus | Tap to focus and expose at a point; long-press locks (AE/AF lock) | New |
| Flash | Photo: off / auto / on. Video: torch on/off | Adds `auto` |
| Timer pill | Red dot + elapsed time; with a limit, counts toward it (`00:12 / 01:00`) and shows a ring on the shutter | Adds limit progress |
| Pause | Pause/resume button beside the shutter while recording | Same |
| Thumbnail | Last capture in multi-capture; tap opens the review tray | New |
| Orientation | Screen stays portrait; icons rotate with the device, the file is saved the right way up | New (today the layout does not react) |
| Haptics | Light tap on shutter, mode change, start/stop recording | New |
| Safe areas | Insets read from native, not the hard-coded `56 / 24 / 48 / 32` in `styles.ts` | Fixes notch / gesture-bar overlap |

### 4.2 Review

- **Photo:** shown instantly from the screen-sized copy (§3.2), pinch to
  inspect, **Retake / Use Photo**. Rotate and crop come later (phase 10).
- **Video:** first frame as poster (not a black screen), duration and size
  (`00:42 · 18 MB`), tap plays in DocumentKit's player, **Retake / Use Video**.
  Showing the size matters on slow networks: the user sees what they are about to upload.

### 4.3 Multi-capture (opt-in)

`openCamera({maxFiles: 5})`. After each capture the camera stays open and live
(≤ 500 ms to the next shot), and the thumbnail stack grows; a **Done (3)**
button replaces the thumbnail. Tapping it opens a tray to review, delete or
retake each item, then resolves `{status: 'picked', files}`. Default
`maxFiles: 1` keeps today's flow (capture → review → done).

### 4.4 Accessibility

Every control labelled (existing `DocumentKitCameraLabels` plus new ones);
recording start/stop and "photo taken" announced; Reduce Motion turns off the
shutter morph and mode-swipe animations; touch targets ≥ 44 pt.

## 5. Architecture

```
CameraViewfinder.tsx (React UI, no camera library)
  │ props                                │ promises / events
  ▼                                      ▼
<DocumentKitCameraView cameraId="…">      NativeDocumentKitCamera (TurboModule)
  Fabric native view                    prewarm()
  preview, pinch/tap gestures,          takePhoto(cameraId, options)
  session lifecycle                     startRecording / stop / pause / resume / cancel
  │                                     getCameraCapabilities(position)
  └──────────── native registry: cameraId → camera session ───────────┘
```

- **Native view component** `DocumentKitCameraView` (new for DocumentKit; everything so
  far is a TurboModule). Spec in `src/specs/DocumentKitCameraViewNativeComponent.ts`.
  Props: `cameraId`, `position`, `mode`, `isActive`, `flash`, `torch`, `zoom`,
  `videoQuality`, `isAudioEnabled`. Events: `onPreviewStarted`, `onCameraError`,
  `onZoomChanged` (throttled), `onInterrupted`.
- **TurboModule** `DocumentKitCamera` for anything that returns a result. It finds
  the session by `cameraId` (a string the JS side generates), so no
  `findNodeHandle`. Rejection codes follow the other modules (`E_BUSY`,
  `E_NOT_READY`, `E_CAPTURE`, `E_STORAGE`).
- **Events** (codegen `EventEmitter`, as in `NativeDocumentKitDownloader`):
  `onRecordingProgress` (seconds, bytes; once a second) and
  `onRecordingFinished`, which also fires when recording ends on its own
  (duration limit, interruption, low storage); dev-only `onTiming` (§3.3).
- **Results** include everything `PickedFile` needs (`uri`, `width`, `height`,
  `size`, `durationMs`, `mimeType`) plus `previewUri`, so `capturedFiles.ts`
  stops calling blob-util and vision-camera types are replaced by DocumentKit's own
  `CapturedPhoto` / `CapturedVideo`.
- Files go to `cacheDir/document-kit/camera` / `Caches/document-kit/camera`, like every
  other DocumentKit file; screen-sized copies are deleted when the session ends.
- **Codegen:** `codegenConfig.type` changes from `"modules"` to `"all"`; iOS
  needs a component provider entry next to `modulesProvider`
  (check the exact key for React Native 0.86 in phase 0). Android registers a
  view manager in `DocumentKitPackage.createViewManagers`.

### Source layout

```
src/camera/
  CameraViewfinder.tsx        rewritten on DocumentKitCameraView
  CameraCaptureModal.tsx      + multi-capture state, fade animation
  ReviewTray.tsx              new (multi-capture)
  VideoReview.tsx             + poster frame and size
  assets/*.png                icons (@1x/@2x/@3x)
src/specs/
  DocumentKitCameraViewNativeComponent.ts
  NativeDocumentKitCamera.ts
android/…/document-kit/camera/
  DocumentKitCameraView.kt  DocumentKitCameraViewManager.kt  DocumentKitCameraModule.kt
  DocumentKitCameraSession.kt  DocumentKitCameraRegistry.kt
ios/
  DocumentKitCameraView.mm  DocumentKitCameraModule.mm  DocumentKitCameraSession.mm
  DocumentKitVideoSegments.mm     (pause/resume, see 7.2)
```

## 6. Android: CameraX

Gradle (Google libraries, allowed by D2): `androidx.camera:camera-core`,
`camera-camera2`, `camera-lifecycle`, `camera-video`, `camera-view`.
App `minSdkVersion` is 29, above CameraX's minimum and the API 24 needed for pause.

**Version:** `1.5.0-alpha03`, the same as react-native-vision-camera 4.7.3, until
phase 8. Gradle resolves one CameraX for the whole app, so a newer DocumentKit
version would also run vision-camera and the app's code scanner on a CameraX
they were not built for (found in phase 0b: 1.6.2 silently upgraded both).
After vision-camera is removed, move to the latest stable (1.6.2 in October 2026).

| Need | How |
|---|---|
| Pre-warm | `ProcessCameraProvider.getInstance` on first `prewarm()`; provider kept for the process |
| Preview | `PreviewView` in `COMPATIBLE` (TextureView) mode so it animates correctly inside the React Native `Modal` |
| Lifecycle | Own `LifecycleOwner`: started when the view is attached, `isActive` is true and the activity is resumed; replaces `useIsAppForeground` for the camera |
| Use cases | Preview + `ImageCapture` + `VideoCapture` bound together; rebind only where the device cannot run all three |
| Photo | `ImageCapture` with `CAPTURE_MODE_MINIMIZE_LATENCY` (ZSL where supported) → JPEG file on a background executor; size and orientation-corrected width/height via `ExifInterface` (already a dependency) |
| Instant review | `PreviewView.getBitmap()` at screen size, shown while the JPEG is written |
| Flash | `ImageCapture.flashMode` off / auto / on; torch via `CameraControl.enableTorch` |
| Video | `Recorder` + `VideoCapture`; `QualitySelector` FHD / HD / SD with fallback to the nearest lower quality; `setTargetVideoEncodingBitRate` per tier; 30 fps |
| Limit | `FileOutputOptions.setDurationLimitMillis` |
| Pause | `Recording.pause()` / `resume()` |
| Audio | `withAudioEnabled()` only when the microphone is granted |
| Zoom / lenses | Native `ScaleGestureDetector` → `CameraControl.setZoomRatio`; ratios below 1× pick the ultra-wide on devices that expose it through the logical camera |
| Focus | Native tap → `FocusMeteringAction` from `PreviewView.meteringPointFactory` |
| Rotation | `OrientationEventListener` → `setTargetRotation` on image and video capture |
| Front camera | Preview mirrored; saved file **not** mirrored (see decisions) |
| Interruptions | Activity paused / camera taken by another app → recording finalised, `onRecordingFinished` with the file |
| Release | `unbindAll()` on close; nothing held between sessions except the provider |

## 7. iOS: AVFoundation

iOS 15+ (podspec `platforms`). `AVFoundation` is already in the podspec.

### 7.1 Session

| Need | How |
|---|---|
| Threads | All session work (`startRunning` blocks for hundreds of ms) on one serial queue, never the main thread |
| Pre-warm | `prewarm()` builds inputs and outputs on the session queue so `startRunning` is the only step left |
| Preview | `AVCaptureVideoPreviewLayer` in the view; fade in on the first frame |
| Outputs | Photo output and movie output both attached; Photo ↔ Video changes the preset inside one `beginConfiguration` / `commitConfiguration` |
| Photo | `AVCapturePhotoOutput`, JPEG (not HEIC: every server and browser reads it); `photoQualityPrioritization = .balanced`; responsive / fast capture on iOS 17+; size from the written file |
| Instant review | Embedded preview image from the photo callback, shown before the full JPEG is saved |
| Flash | `AVCapturePhotoSettings.flashMode`; torch via `AVCaptureDevice.torchMode` |
| Video | `AVCaptureMovieFileOutput`, H.264 (`AVVideoCodecTypeH264`); session preset per tier (1920×1080 / 1280×720 / 640×480); 30 fps |
| MP4 | One passthrough export (`.mov` → MP4, segments joined) started on stop, reusing the export code in `DocumentKitMediaPicker.mm` / `DocumentKitFileUtils` |
| Limit | `maxRecordedDuration` |
| Audio | Microphone input added only when granted |
| Zoom / lenses | Virtual devices (`builtInTripleCamera`, `builtInDualWideCamera`, …) so 0.5× → 1× → 2× switches lenses smoothly; native pinch recogniser; `virtualDeviceSwitchOverVideoZoomFactors` drives the pills |
| Focus | Native tap → `focusPointOfInterest` / `exposurePointOfInterest` |
| Rotation | `AVCaptureDevice.RotationCoordinator` on iOS 17+, `videoOrientation` from device orientation on 15–16 |
| Interruptions | `AVCaptureSessionWasInterruptedNotification` (calls, Split View, another app) → finish and keep the recording; resume the session after |
| Front camera | Preview mirrored; saved file not mirrored |
| Release | `stopRunning` on the session queue when the modal closes |

### 7.2 Pause / resume

`AVCaptureMovieFileOutput` cannot pause on iOS (only on macOS).

**Planned:** segments. Pause stops the current file; resume starts a new one;
on stop, segments are joined with `AVMutableComposition` and exported with
passthrough (no re-encode) straight to MP4, in the same export as the MP4
re-wrap, so pausing adds no extra wait. Elapsed time and the duration limit
count across segments. Expect a short gap (a few frames) at each pause.

**Alternative** if the gap is not acceptable: `AVCaptureVideoDataOutput` +
`AVCaptureAudioDataOutput` + `AVAssetWriter`, dropping samples while paused
and shifting timestamps. Writes MP4 directly (no export step at all), exact
bitrate control, but more code (A/V sync, orientation transform). Only if
segments fail device testing or the export misses the §3.1 budget.

## 8. Phases

Estimates are rough working days for one developer, including device testing.

| # | Phase | Output | Est. |
|---|---|---|---|
| 0a | **Quick win (current camera)** | Parallel start-up in `openCamera` (§3.2) and fade-in modal; ships on vision-camera now | 1 |
| 0b | **Spike + baseline** | Timing marks (§3.3); vision-camera baseline on the test devices; empty `DocumentKitCameraView` showing a live preview inside the DocumentKit `Modal` on both platforms; codegen `type: "all"` building in the host app; pre-warm prototype with first-frame time measured; decisions in §11 confirmed | 4–5 |
| 1 | **Android photo** | View, session, pre-warm, takePhoto (latency mode, instant review, `previewUri`), flash, switch, native pinch/tap, rotation; `CameraViewfinder` running on it behind a flag | 7–9 |
| 2 | **Android video** | All use cases bound together, record / stop / pause / resume, tiers, bitrate, limit, audio off, torch, interruptions, progress events, poster frame | 5–7 |
| 3 | **iOS photo** | Same as phase 1 on AVFoundation | 7–9 |
| 4 | **iOS video** | Same as phase 2, segments for pause, single MP4 export on stop | 7–9 |
| 5 | **New UI** | §4.1–4.2: mode swipe, shutter morph, lens pills, limit ring, poster + size, haptics, rotating icons, native safe-area insets, PNG icons, native-driver animations. JS-only, can run alongside 1–4 | 5–7 |
| 6 | **Multi-capture** | §4.3: `maxFiles`, thumbnail stack, review tray on screen-sized copies | 3–4 |
| 7 | **Switch-over** | Device test matrix (§9) and speed comparison (§3.3) on a `0.2.0-beta`; fix; make native the default only when every budget is met | 6–9 |
| 8 | **Remove libraries** | Delete vision-camera, blob-util and svg imports; remove them from `peerDependencies` / `devDependencies`; add them to the ESLint blocklist; update README and DESIGN.md; publish `0.2.0` | 1–2 |

**Total: about 46–62 days** (9–12 weeks for one developer; phases 1–2 and
3–4 can run in parallel with two developers, about 6–8 weeks).

**Progress (October 2026):**

- 0a: done.
- 0b: code done (timing marks, `DocumentKitCameraView`, pre-warm). Android
  preview works on the emulator. Open: real-device numbers, iOS compile
  (`pod install` blocked in the host app), §11 decisions.
- 1–2, 5–6 (Android): code done; the app builds, lint is clean, the JS
  bundles; not yet run on a device. Shortcuts to measure before changing:
  `takePhoto` resolves after the full JPEG is saved (the preview freezes on the
  shot meanwhile) rather than handing over the screen-sized copy first; the
  latency mode is `MINIMIZE_LATENCY`, not zero-shutter-lag; the duration limit
  shows as `00:12 / 01:00` in the timer pill, not a ring; tap to focus has no
  on-screen square yet.
- 3–4 (iOS): code done and type-checked against the app's Pods headers and
  fresh codegen; not built in Xcode (`pod install` blocked) and not run.
  Pause/resume uses segments (§7.2); orientation comes from the accelerometer,
  so it works with the rotation lock on, as on Android.
- 5: icons are bundled PNGs; DocumentKit no longer imports `react-native-svg`.
- 7: not done. Device testing (§9) and the speed comparison (§3.3) are still
  to do; the vision-camera baseline (§3.3) can now only be measured on an
  older DocumentKit build.
- 8: done (October 2026), ahead of 7 at the team's request. The vision-camera
  screen and the `cameraEngine` switch are gone; DocumentKit's peers are only
  `react` and `react-native`; ESLint blocks the three libraries. There is no
  in-app fallback: an app binary without the camera module resolves
  `unavailable`, and FilePicker opens the OS camera instead. CameraX stays
  pinned to vision-camera's version while the app's scanner uses it (§6).

### Later

| # | Phase | Notes |
|---|---|---|
| 9 | **Code scanning** → app drops vision-camera | `scanCode()` in DocumentKit on the same camera view and pre-warm. iOS: `AVCaptureMetadataOutput` (built in). Android: ML Kit barcode scanning (Google library). Covers the formats the app scanner uses today (Aztec, Code 39/93, …). Only after this does vision-camera leave the app binary. |
| 10 | **Document scanning** | `scanDocument()` → multi-page JPEG or PDF with edge detection, crop and perspective fix. iOS: VisionKit `VNDocumentCameraViewController`. Android: ML Kit Document Scanner (UI from Google Play services, no camera permission needed). Fits "document-kit"; replaces photographing paper with the photo camera. Plus rotate/crop on photo review. |

## 9. Testing

**Devices (minimum):**

| Platform | Devices |
|---|---|
| Android | Low-end Android 10 (2–3 GB RAM; the speed budget device); Samsung mid-range (One UI); Pixel (current Android); Xiaomi/Redmi (aggressive background killing); one device with an ultra-wide lens |
| iOS | iPhone SE 2/3 (single lens, iOS 15/16; the speed budget device); a recent Pro (triple camera, iOS 18+) |

**Scenarios:**

- Speed: every §3.1 moment, 10 runs each, cold (first open after app start)
  and warm; native vs vision-camera on the same device.
- Permissions: first ask, denied, blocked → Settings → back; microphone refused → silent video and notice.
- Photo: back/front, flash off/auto/on in the dark, every orientation, zoom per lens, tap focus.
- Video: each tier (check resolution, bitrate and file size per minute), pause/resume several times, duration limit stop, torch, rotation while recording.
- Interruptions: incoming call, app to background, lock screen, Control Center, another camera app, low storage mid-recording.
- Front camera: saved photo/video readable (text not mirrored).
- End to end: `FilePicker` → compression → upload on a slow network.
- Memory and heat: 20 photos in multi-capture on the low-end device; 10-minute recording (no frame drops, no overheating warning).
- Accessibility: TalkBack / VoiceOver through the whole flow.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Native camera is not measurably faster | Baseline in phase 0b; budgets gate phase 7; pre-warm and latency modes are the main levers |
| Fabric native view is new to DocumentKit | Phase 0b spike proves it in the real app before any camera work |
| Some devices cannot bind preview + photo + video together | Detected at bind time; fall back to rebinding on mode switch (slower switch on those devices only) |
| Android device quirks (orientation, front camera, OEM camera HALs) | CameraX handles most; wide device matrix; flag keeps vision-camera as fallback until phase 7 |
| Preview surface inside React Native `Modal` (black or stretched preview during animation) | `PreviewView` COMPATIBLE mode; fade in on first frame; tested in phase 0b |
| iOS pause gap / export time on long videos | Single export during review; AVAssetWriter fallback (§7.2) |
| Estimate slips | Phases ship independently; Android can go first |
| App still ships vision-camera for the scanner | Expected; phase 9 removes it |
| Shared CameraX version with vision-camera (Android) | DocumentKit pins vision-camera's version until phase 8 (§6); check again whenever either changes |

## 11. Decisions to confirm

| Question | Proposal |
|---|---|
| Speed budgets (§3.1) | Accept as the phase 7 gate |
| Photo pipeline | Latency-first (minimize latency / `.balanced`): faster shutter, still full resolution; the app compresses afterwards anyway |
| Pre-warm | DocumentKit pre-warms during the permission check and modal animation; `prewarm()` exported for screens with a camera button; never at app start |
| iOS pause/resume | Segments (§7.2); drop pause on iOS only if segments fail testing |
| Multi-capture in the first release? | Yes, opt-in via `maxFiles`; default 1 keeps today's flow |
| Photo format | JPEG on both platforms (HEIC is smaller but not every server/browser reads it) |
| Front camera saved file | Not mirrored, so documents and text read correctly |
| Flash `auto` | Yes for photos |
| Rotate / crop on review | Later (phase 10), with document scanning |
| Ship order | Android first (current device-testing focus), iOS after |

## Sources

- [What's New in VisionCamera V5](https://margelo.com/blog/whats-new-in-visioncamera-v5) (Margelo, April 2026)
- [ML Kit Document Scanner](https://developers.google.com/ml-kit/vision/doc-scanner)
- [Document scanner crop UI](https://vp0.com/blogs/document-scanner-crop-ui-like-camscanner.md),
  [Microblink UI/UX best practices](https://docs.microblink.com/blinkid/ui-ux-best-practices),
  [Veridas capture recommendations](https://docs.veridas.com/document-sdk/html/v6.8/configuration/recommendations/)
- npm registry and download API: `react-native-vision-camera` 4.x last release
  12 Nov 2025; 5.2.3 on 20 Aug 2026
