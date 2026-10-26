#import "DocumentKitCameraSessions.h"

// Long enough to cover the permission prompts and the screen opening; after that
// the camera screen is not coming, so the camera is let go.
static const int64_t DocumentKitPrewarmLifetimeSeconds = 10;

dispatch_queue_t DocumentKitCameraQueue(void)
{
  static dispatch_queue_t queue;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    queue = dispatch_queue_create("com.documentkit.camera", DISPATCH_QUEUE_SERIAL);
  });
  return queue;
}

AVCaptureDevice *_Nullable DocumentKitCameraDevice(AVCaptureDevicePosition position)
{
  NSArray<AVCaptureDeviceType> *types = position == AVCaptureDevicePositionBack
      ? @[
          AVCaptureDeviceTypeBuiltInTripleCamera,
          AVCaptureDeviceTypeBuiltInDualWideCamera,
          AVCaptureDeviceTypeBuiltInDualCamera,
          AVCaptureDeviceTypeBuiltInWideAngleCamera,
        ]
      : @[ AVCaptureDeviceTypeBuiltInWideAngleCamera ];
  for (AVCaptureDeviceType type in types) {
    AVCaptureDevice *device = [AVCaptureDevice defaultDeviceWithDeviceType:type
                                                                 mediaType:AVMediaTypeVideo
                                                                  position:position];
    if (device != nil) {
      return device;
    }
  }
  return nil;
}

CGFloat DocumentKitWideZoomFactor(AVCaptureDevice *device)
{
  for (AVCaptureDevice *lens in device.constituentDevices) {
    if ([lens.deviceType isEqualToString:AVCaptureDeviceTypeBuiltInUltraWideCamera]) {
      NSNumber *firstSwitch = device.virtualDeviceSwitchOverVideoZoomFactors.firstObject;
      return firstSwitch != nil ? firstSwitch.doubleValue : 1;
    }
  }
  return 1;
}

// Camera queue only.
static AVCaptureSession *DocumentKitPrewarmedSession;
static AVCaptureDevicePosition DocumentKitPrewarmedPosition;
// Bumped whenever the held session changes, so an old expiry does not drop a newer one.
static NSUInteger DocumentKitPrewarmGeneration;

@implementation DocumentKitCameraSessions

+ (void)prewarmPosition:(AVCaptureDevicePosition)position
{
  if (DocumentKitPrewarmedSession != nil && DocumentKitPrewarmedPosition == position) {
    return;
  }
  DocumentKitPrewarmedSession = nil;
  DocumentKitPrewarmGeneration++;

  // Missing camera or a failed input: the camera screen reports it when it opens.
  AVCaptureDevice *device = DocumentKitCameraDevice(position);
  AVCaptureDeviceInput *input = device ? [AVCaptureDeviceInput deviceInputWithDevice:device error:nil] : nil;
  if (input == nil) {
    return;
  }
  AVCaptureSession *session = [AVCaptureSession new];
  if (![session canAddInput:input]) {
    return;
  }
  [session beginConfiguration];
  [session addInput:input];
  [session commitConfiguration];

  DocumentKitPrewarmedSession = session;
  DocumentKitPrewarmedPosition = position;
  NSUInteger generation = DocumentKitPrewarmGeneration;
  dispatch_after(
      dispatch_time(DISPATCH_TIME_NOW, DocumentKitPrewarmLifetimeSeconds * NSEC_PER_SEC), DocumentKitCameraQueue(), ^{
        if (generation == DocumentKitPrewarmGeneration) {
          DocumentKitPrewarmedSession = nil;
        }
      });
}

+ (nullable AVCaptureSession *)takeSessionForPosition:(AVCaptureDevicePosition)position
{
  if (DocumentKitPrewarmedSession == nil || DocumentKitPrewarmedPosition != position) {
    return nil;
  }
  AVCaptureSession *session = DocumentKitPrewarmedSession;
  DocumentKitPrewarmedSession = nil;
  DocumentKitPrewarmGeneration++;
  return session;
}

@end
