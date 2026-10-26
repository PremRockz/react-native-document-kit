#import "DocumentKitCameraRecorder.h"

#import "DocumentKitCameraSessions.h"
#import "DocumentKitFileUtils.h"

typedef NS_ENUM(NSInteger, DocumentKitRecorderState) {
  /// A segment is being written.
  DocumentKitRecorderStateRecording,
  /// The segment is closing for a pause.
  DocumentKitRecorderStatePausing,
  DocumentKitRecorderStatePaused,
  /// The last segment is closing.
  DocumentKitRecorderStateStopping,
  DocumentKitRecorderStateFinished,
};

/// Joins the segments in order and writes one MP4 without re-encoding.
/// Blocks the calling (background) queue until the export ends.
static NSURL *_Nullable DocumentKitJoinSegments(NSArray<NSURL *> *segments, NSError **error)
{
  AVMutableComposition *composition = [AVMutableComposition composition];
  AVMutableCompositionTrack *videoTrack =
      [composition addMutableTrackWithMediaType:AVMediaTypeVideo preferredTrackID:kCMPersistentTrackID_Invalid];
  AVMutableCompositionTrack *audioTrack = nil;
  CMTime cursor = kCMTimeZero;
  for (NSURL *url in segments) {
    AVURLAsset *asset = [AVURLAsset URLAssetWithURL:url options:@{AVURLAssetPreferPreciseDurationAndTimingKey : @YES}];
    AVAssetTrack *video = [asset tracksWithMediaType:AVMediaTypeVideo].firstObject;
    if (video == nil) {
      continue;
    }
    CMTimeRange range = CMTimeRangeMake(kCMTimeZero, asset.duration);
    if (![videoTrack insertTimeRange:range ofTrack:video atTime:cursor error:error]) {
      return nil;
    }
    if (CMTimeCompare(cursor, kCMTimeZero) == 0) {
      // Every segment keeps the orientation the recording started with.
      videoTrack.preferredTransform = video.preferredTransform;
    }
    AVAssetTrack *audio = [asset tracksWithMediaType:AVMediaTypeAudio].firstObject;
    if (audio != nil) {
      if (audioTrack == nil) {
        audioTrack = [composition addMutableTrackWithMediaType:AVMediaTypeAudio
                                              preferredTrackID:kCMPersistentTrackID_Invalid];
      }
      [audioTrack insertTimeRange:range ofTrack:audio atTime:cursor error:nil];
    }
    cursor = CMTimeAdd(cursor, asset.duration);
  }
  if (CMTimeCompare(cursor, kCMTimeZero) == 0) {
    if (error != NULL) {
      *error = [DocumentKitFileUtils errorWithMessage:@"No video was recorded"];
    }
    return nil;
  }

  NSURL *directory = [DocumentKitFileUtils rootDirectoryWithError:error];
  if (directory == nil) {
    return nil;
  }
  NSURL *target = [directory URLByAppendingPathComponent:[DocumentKitFileUtils timestampedName:@"Video" extension:@"mp4"]];
  AVAssetExportSession *exportSession = [AVAssetExportSession exportSessionWithAsset:composition
                                                                          presetName:AVAssetExportPresetPassthrough];
  exportSession.outputURL = target;
  exportSession.outputFileType = AVFileTypeMPEG4;
  exportSession.shouldOptimizeForNetworkUse = YES;
  dispatch_semaphore_t done = dispatch_semaphore_create(0);
  [exportSession exportAsynchronouslyWithCompletionHandler:^{
    dispatch_semaphore_signal(done);
  }];
  dispatch_semaphore_wait(done, DISPATCH_TIME_FOREVER);
  if (exportSession.status != AVAssetExportSessionStatusCompleted) {
    if (error != NULL) {
      *error = exportSession.error ?: [DocumentKitFileUtils errorWithMessage:@"Video export failed"];
    }
    return nil;
  }
  return target;
}

@implementation DocumentKitCameraRecorder {
  AVCaptureMovieFileOutput *_output;
  double _maxDurationSeconds;
  DocumentKitRecordingCompletion _completion;
  NSURL *_folder;
  NSMutableArray<NSURL *> *_segments;
  NSUInteger _segmentNumber;
  double _finishedSeconds;
  double _finishedBytes;
  DocumentKitRecorderState _state;
  BOOL _isResumeRequested;
  BOOL _isCancelled;
  NSError *_failure;
}

- (instancetype)initWithOutput:(AVCaptureMovieFileOutput *)output
            maxDurationSeconds:(double)maxDurationSeconds
                    completion:(DocumentKitRecordingCompletion)completion
{
  if (self = [super init]) {
    _output = output;
    _maxDurationSeconds = maxDurationSeconds;
    _completion = [completion copy];
    _segments = [NSMutableArray new];
    _state = DocumentKitRecorderStateFinished;
  }
  return self;
}

- (BOOL)start:(NSError **)error
{
  _folder = [DocumentKitFileUtils uniqueDirectoryWithError:error];
  if (_folder == nil) {
    return NO;
  }
  [self startSegment];
  return YES;
}

- (void)pause
{
  if (_state == DocumentKitRecorderStateRecording) {
    _state = DocumentKitRecorderStatePausing;
    [_output stopRecording];
  } else if (_state == DocumentKitRecorderStatePausing) {
    _isResumeRequested = NO;
  }
}

- (void)resume
{
  if (_state == DocumentKitRecorderStatePaused) {
    [self startSegment];
  } else if (_state == DocumentKitRecorderStatePausing) {
    // The paused segment has not closed yet; start the next one once it has.
    _isResumeRequested = YES;
  }
}

- (void)stop
{
  switch (_state) {
    case DocumentKitRecorderStateRecording:
      _state = DocumentKitRecorderStateStopping;
      [_output stopRecording];
      break;
    case DocumentKitRecorderStatePausing:
      // The closing segment finishes the recording.
      _state = DocumentKitRecorderStateStopping;
      break;
    case DocumentKitRecorderStatePaused:
      [self finish];
      break;
    case DocumentKitRecorderStateStopping:
    case DocumentKitRecorderStateFinished:
      break;
  }
}

- (void)cancel
{
  _isCancelled = YES;
  [self stop];
}

- (double)recordedSeconds
{
  if (_state != DocumentKitRecorderStateRecording) {
    return _finishedSeconds;
  }
  double current = CMTimeGetSeconds(_output.recordedDuration);
  return _finishedSeconds + (isfinite(current) ? current : 0);
}

- (double)recordedBytes
{
  return _finishedBytes + (_state == DocumentKitRecorderStateRecording ? _output.recordedFileSize : 0);
}

#pragma mark - Segments

- (void)startSegment
{
  double remaining = _maxDurationSeconds > 0 ? _maxDurationSeconds - _finishedSeconds : 0;
  if (_maxDurationSeconds > 0 && remaining < 0.1) {
    [self finish];
    return;
  }
  _segmentNumber++;
  NSURL *url = [_folder URLByAppendingPathComponent:[NSString stringWithFormat:@"segment-%lu.mov",
                                                                               (unsigned long)_segmentNumber]];
  _output.maxRecordedDuration = remaining > 0 ? CMTimeMakeWithSeconds(remaining, 600) : kCMTimeInvalid;
  _state = DocumentKitRecorderStateRecording;
  [_output startRecordingToOutputFileURL:url recordingDelegate:self];
}

- (void)captureOutput:(AVCaptureFileOutput *)output
    didFinishRecordingToOutputFileAtURL:(NSURL *)outputFileURL
                        fromConnections:(NSArray<AVCaptureConnection *> *)connections
                                  error:(nullable NSError *)error
{
  dispatch_async(DocumentKitCameraQueue(), ^{
    [self segmentDidFinish:outputFileURL error:error];
  });
}

/// Camera queue.
- (void)segmentDidFinish:(NSURL *)url error:(nullable NSError *)error
{
  // A limit, an interruption or low storage end a segment early but keep it playable.
  BOOL isKept = error == nil || [error.userInfo[AVErrorRecordingSuccessfullyFinishedKey] boolValue];
  if (isKept && [NSFileManager.defaultManager fileExistsAtPath:url.path]) {
    AVURLAsset *asset = [AVURLAsset assetWithURL:url];
    double seconds = CMTimeGetSeconds(asset.duration);
    if (isfinite(seconds) && seconds > 0) {
      [_segments addObject:url];
      _finishedSeconds += seconds;
      NSNumber *size = [NSFileManager.defaultManager attributesOfItemAtPath:url.path error:nil][NSFileSize];
      _finishedBytes += size.doubleValue;
    }
  } else if (!isKept) {
    _failure = error;
  }

  if (_state == DocumentKitRecorderStatePausing && error == nil) {
    _state = DocumentKitRecorderStatePaused;
    if (_isResumeRequested) {
      _isResumeRequested = NO;
      [self startSegment];
    }
    return;
  }
  // Stopping, or iOS ended the segment while recording or pausing: the recording is over.
  if (_state != DocumentKitRecorderStateFinished) {
    [self finish];
  }
}

- (void)finish
{
  _state = DocumentKitRecorderStateFinished;
  NSArray<NSURL *> *segments = [_segments copy];
  NSURL *folder = _folder;
  BOOL isCancelled = _isCancelled;
  NSError *failure = _failure;
  DocumentKitRecordingCompletion completion = _completion;
  _completion = nil;
  if (completion == nil) {
    return;
  }
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    NSURL *mp4URL = nil;
    NSError *error = nil;
    if (!isCancelled) {
      if (segments.count > 0) {
        mp4URL = DocumentKitJoinSegments(segments, &error);
      } else {
        error = failure ?: [DocumentKitFileUtils errorWithMessage:@"No video was recorded"];
      }
    }
    [NSFileManager.defaultManager removeItemAtURL:folder error:nil];
    completion(mp4URL, mp4URL != nil ? nil : error, isCancelled);
  });
}

@end
