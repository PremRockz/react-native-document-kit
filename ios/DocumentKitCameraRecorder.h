#import <AVFoundation/AVFoundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Called once, on a background queue: the MP4 when the recording was kept,
/// an error when it failed, or neither when it was cancelled.
typedef void (^DocumentKitRecordingCompletion)(NSURL *_Nullable mp4URL, NSError *_Nullable error, BOOL isCancelled);

/// One recording with AVCaptureMovieFileOutput, which cannot pause on iOS.
/// Pausing ends the current segment and resuming starts another; at the end the
/// segments are joined and re-wrapped as MP4 in one passthrough export (no
/// re-encode). The duration limit counts across segments. Recording ended by
/// iOS (limit, interruption, low storage) keeps what was recorded.
/// Camera queue (DocumentKitCameraQueue) only.
@interface DocumentKitCameraRecorder : NSObject <AVCaptureFileOutputRecordingDelegate>

- (instancetype)initWithOutput:(AVCaptureMovieFileOutput *)output
            maxDurationSeconds:(double)maxDurationSeconds
                    completion:(DocumentKitRecordingCompletion)completion;
- (instancetype)init NS_UNAVAILABLE;

/// Starts the first segment. NO when the segment folder cannot be created.
- (BOOL)start:(NSError **)error;
- (void)pause;
- (void)resume;
/// Ends the recording and keeps it.
- (void)stop;
/// Ends the recording and deletes it.
- (void)cancel;

/// Recorded so far, pauses excluded.
@property (nonatomic, readonly) double recordedSeconds;
@property (nonatomic, readonly) double recordedBytes;

@end

NS_ASSUME_NONNULL_END
