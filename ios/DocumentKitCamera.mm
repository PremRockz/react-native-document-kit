#import "DocumentKitCamera.h"

#import <AVFoundation/AVFoundation.h>

#import "DocumentKitCameraSessions.h"
#import "DocumentKitCameraViewComponentView.h"
#import "DocumentKitPhotoEditor.h"

@implementation DocumentKitCamera

RCT_EXPORT_MODULE()

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (void)prewarm:(NSString *)position resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  // Creating a camera input before permission is granted would show the permission prompt.
  if ([AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeVideo] != AVAuthorizationStatusAuthorized) {
    resolve(nil);
    return;
  }
  AVCaptureDevicePosition devicePosition =
      [position isEqualToString:@"front"] ? AVCaptureDevicePositionFront : AVCaptureDevicePositionBack;
  dispatch_async(DocumentKitCameraQueue(), ^{
    [DocumentKitCameraSessions prewarmPosition:devicePosition];
    resolve(nil);
  });
}

/// Runs on the main thread with the mounted view; a missing view rejects E_NOT_READY, or is ignored without a promise.
static void DocumentKitWithView(NSString *cameraId,
                            RCTPromiseRejectBlock _Nullable reject,
                            void (^action)(DocumentKitCameraViewComponentView *view))
{
  dispatch_async(dispatch_get_main_queue(), ^{
    DocumentKitCameraViewComponentView *view = [DocumentKitCameraViewComponentView viewForCameraId:cameraId];
    if (view != nil) {
      action(view);
    } else if (reject != nil) {
      reject(@"E_NOT_READY", [NSString stringWithFormat:@"No camera view with id %@", cameraId], nil);
    }
  });
}

static DocumentKitCameraCompletion DocumentKitSettle(RCTPromiseResolveBlock resolve, RCTPromiseRejectBlock reject)
{
  return ^(NSDictionary *file, NSString *errorCode, NSString *errorMessage) {
    if (file != nil) {
      resolve(file);
    } else {
      reject(errorCode ?: @"E_CAPTURE", errorMessage, nil);
    }
  };
}

- (void)takePhoto:(NSString *)cameraId
            flash:(NSString *)flash
          resolve:(RCTPromiseResolveBlock)resolve
           reject:(RCTPromiseRejectBlock)reject
{
  DocumentKitWithView(cameraId, reject, ^(DocumentKitCameraViewComponentView *view) {
    [view takePhotoWithFlash:flash completion:DocumentKitSettle(resolve, reject)];
  });
}

- (void)resumePreview:(NSString *)cameraId
{
  DocumentKitWithView(cameraId, nil, ^(DocumentKitCameraViewComponentView *view) {
    [view resumePreview];
  });
}

- (void)startRecording:(NSString *)cameraId
               options:(JS::NativeDocumentKitCamera::NativeRecordingOptions &)options
               resolve:(RCTPromiseResolveBlock)resolve
                reject:(RCTPromiseRejectBlock)reject
{
  BOOL isAudioEnabled = options.isAudioEnabled();
  double maxDurationSeconds = options.maxDurationSeconds();
  DocumentKitWithView(cameraId, reject, ^(DocumentKitCameraViewComponentView *view) {
    [view startRecordingWithAudio:isAudioEnabled
               maxDurationSeconds:maxDurationSeconds
                       completion:DocumentKitSettle(resolve, reject)];
  });
}

- (void)stopRecording:(NSString *)cameraId
{
  DocumentKitWithView(cameraId, nil, ^(DocumentKitCameraViewComponentView *view) {
    [view stopRecording];
  });
}

- (void)pauseRecording:(NSString *)cameraId
{
  DocumentKitWithView(cameraId, nil, ^(DocumentKitCameraViewComponentView *view) {
    [view pauseRecording];
  });
}

- (void)resumeRecording:(NSString *)cameraId
{
  DocumentKitWithView(cameraId, nil, ^(DocumentKitCameraViewComponentView *view) {
    [view resumeRecording];
  });
}

- (void)cancelRecording:(NSString *)cameraId
{
  DocumentKitWithView(cameraId, nil, ^(DocumentKitCameraViewComponentView *view) {
    [view cancelRecording];
  });
}

- (void)setZoom:(NSString *)cameraId zoom:(double)zoom
{
  DocumentKitWithView(cameraId, nil, ^(DocumentKitCameraViewComponentView *view) {
    [view setZoom:zoom];
  });
}

- (void)editPhoto:(NSString *)uri
            edits:(JS::NativeDocumentKitCamera::NativePhotoEdits &)edits
          resolve:(RCTPromiseResolveBlock)resolve
           reject:(RCTPromiseRejectBlock)reject
{
  NSURL *photoURL = [NSURL URLWithString:uri];
  if (photoURL == nil || !photoURL.isFileURL) {
    reject(@"E_STORAGE", @"Not a file URI", nil);
    return;
  }
  // Read now: the codegen struct only wraps the JS value for the length of this call.
  JS::NativeDocumentKitCamera::NativeCropRect crop = edits.crop();
  CGRect cropRect = CGRectMake(crop.x(), crop.y(), crop.width(), crop.height());
  NSInteger rotation = (NSInteger)edits.rotationDegrees();
  BOOL isFlipped = edits.isFlipped();
  CGFloat straighten = edits.straightenDegrees();
  CGFloat maxPixels = MAX(UIScreen.mainScreen.nativeBounds.size.width, UIScreen.mainScreen.nativeBounds.size.height);
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    NSError *error = nil;
    NSDictionary *photo = [DocumentKitPhotoEditor editPhoto:photoURL
                                                   rotation:rotation
                                                  isFlipped:isFlipped
                                                 straighten:straighten
                                                       crop:cropRect
                                           maxDisplayPixels:maxPixels
                                                      error:&error];
    if (photo != nil) {
      resolve(photo);
    } else {
      reject(@"E_STORAGE", error.localizedDescription ?: @"Cannot edit the photo", error);
    }
  });
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeDocumentKitCameraSpecJSI>(params);
}

@end
