# Changelog

## 0.1.1

Docs only, no code changes.

- **Shorter README:** the npm page is now a short overview. The full guide moved to [`docs/GUIDE.md`](https://github.com/PremRockz/react-native-document-kit/blob/main/docs/GUIDE.md).
- **Live demo:** the README links to the Playground app running in the browser ([try it](https://appetize.io/app/b_grlhwnmqijfqcq4kxve2kg3n6i)).
- **README:** screenshots, npm badges, an Expo section, a fuller iOS status note and a contributing section. The npm homepage is now the documentation site.
- **Playground:** a demo app in `example/` with every option as a switch, showing the call it made and what it returned. Its video and text samples point to working URLs.

## 0.1.0

First release. Android is ready; iOS is experimental (complete and compiling, not yet run on a device).

- **In-app camera:** photo and video
  - flash and torch, zoom, front/back
  - multiple captures (`allowMultiple`)
  - a review screen with a Crop & Rotate editor: crop with shape presets, straighten, rotate, flip
- **System camera:** photo and video.
- **Photo library and document picker:** single or multiple selection. The library can reuse the camera's review screen.
- **Downloads:** caching, retries, resume, `forceRefresh` and Android notifications. Saving to the device.
- **In-app preview:** PDF, images, text, CSV and HTML, plus DocumentKit's own video and audio player (speed, skip, mute, full screen, download).
- **Expired sessions:** a 401/403 calls `onUnauthorized`, which can supply fresh headers for one retry.
- **Customisation:** every colour, the font and every text (`theme`, `labels`).
