#import <AVFoundation/AVFoundation.h>

NS_ASSUME_NONNULL_BEGIN

/// The one serial queue for all capture-session work. Pre-warming builds a
/// session that DocumentKitCameraView then takes over, so both run on this queue.
dispatch_queue_t DocumentKitCameraQueue(void);

/// The camera at `position`, or nil when the device has none. At the back, the
/// multi-lens camera when there is one, so zooming below and above 1× switches
/// lenses smoothly (as in the Camera app); otherwise the wide-angle camera.
AVCaptureDevice *_Nullable DocumentKitCameraDevice(AVCaptureDevicePosition position);

/// The zoom factor that shows the wide-angle lens ("1×" in the UI): above 1
/// on multi-lens cameras that include an ultra-wide, otherwise 1.
CGFloat DocumentKitWideZoomFactor(AVCaptureDevice *device);

/// Holds at most one session, configured but not running, built ahead of the camera screen.
@interface DocumentKitCameraSessions : NSObject

/// Camera queue only. Builds a session with the camera at `position`, replacing
/// any other. Released after a few seconds if no camera screen takes it.
+ (void)prewarmPosition:(AVCaptureDevicePosition)position;

/// Camera queue only. The pre-warmed session for `position`, or nil. The caller owns it from here.
+ (nullable AVCaptureSession *)takeSessionForPosition:(AVCaptureDevicePosition)position;

@end

NS_ASSUME_NONNULL_END
