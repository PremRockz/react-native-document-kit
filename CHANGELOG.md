# Changelog

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
