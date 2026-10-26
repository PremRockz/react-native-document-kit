#import <React/RCTViewComponentView.h>
#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

/// The result of a capture, on the main queue: the file (NativeCapturedPhoto /
/// NativeCapturedVideo shape) or a rejection code and message.
typedef void (^DocumentKitCameraCompletion)(NSDictionary *_Nullable file,
                                        NSString *_Nullable errorCode,
                                        NSString *_Nullable errorMessage);

/// Live camera on AVFoundation: the Fabric component `DocumentKitCameraView`, with
/// photo, video (MP4, H.264), pinch zoom, tap to focus and swipe between modes.
/// DocumentKitCamera (the module) drives capture through the methods below.
@interface DocumentKitCameraViewComponentView : RCTViewComponentView

/// The mounted view with this `cameraId`, or nil. Main thread.
+ (nullable instancetype)viewForCameraId:(NSString *)cameraId;

/// `flash` is "off", "on" or "auto". The preview freezes on the shot until
/// resumePreview or the view goes away. Main thread.
- (void)takePhotoWithFlash:(NSString *)flash completion:(DocumentKitCameraCompletion)completion;
- (void)resumePreview;

/// The completion runs once, when the recording ends (stop, limit, interruption);
/// after cancelRecording it gets E_CANCELLED. Main thread.
- (void)startRecordingWithAudio:(BOOL)isAudioEnabled
             maxDurationSeconds:(double)maxDurationSeconds
                     completion:(DocumentKitCameraCompletion)completion;
- (void)stopRecording;
- (void)pauseRecording;
- (void)resumeRecording;
- (void)cancelRecording;

/// In the UI's terms: 1 is the wide-angle lens, 0.5 the ultra-wide.
- (void)setZoom:(double)zoom;

@end

NS_ASSUME_NONNULL_END
