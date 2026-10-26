#import "DocumentKitCameraViewComponentView.h"

#import <AVFoundation/AVFoundation.h>
#import <CoreMotion/CoreMotion.h>
#import <ImageIO/ImageIO.h>

#import <atomic>

#import <react/renderer/components/RNDocumentKitSpec/ComponentDescriptors.h>
#import <react/renderer/components/RNDocumentKitSpec/EventEmitters.h>
#import <react/renderer/components/RNDocumentKitSpec/Props.h>
#import <react/renderer/components/RNDocumentKitSpec/RCTComponentViewHelpers.h>

#import "DocumentKitCameraRecorder.h"
#import "DocumentKitCameraSessions.h"
#import "DocumentKitFileUtils.h"
#import "DocumentKitPhotoEditor.h"

using namespace facebook::react;

static NSString *const DocumentKitCameraErrorNoDevice = @"no_device";
static NSString *const DocumentKitCameraErrorSessionFailed = @"session_failed";
static NSString *const DocumentKitCodeNotReady = @"E_NOT_READY";
static NSString *const DocumentKitCodeBusy = @"E_BUSY";
static NSString *const DocumentKitCodeCapture = @"E_CAPTURE";
static NSString *const DocumentKitCodeStorage = @"E_STORAGE";
static NSString *const DocumentKitCodeCancelled = @"E_CANCELLED";

static const CGFloat DocumentKitZoomReportStep = 0.05;
static const CGFloat DocumentKitMaxDisplayZoom = 10;
// Gravity along one axis above this means the phone is held that way up.
static const double DocumentKitOrientationThreshold = 0.75;

/// Session presets per recording tier (src/camera/types.ts VIDEO_SETTINGS), best first.
static NSArray<AVCaptureSessionPreset> *DocumentKitVideoPresets(DocumentKitCameraViewVideoQuality quality)
{
  switch (quality) {
    case DocumentKitCameraViewVideoQuality::High:
      return @[ AVCaptureSessionPreset1920x1080, AVCaptureSessionPreset1280x720, AVCaptureSessionPreset640x480 ];
    case DocumentKitCameraViewVideoQuality::Medium:
      return @[ AVCaptureSessionPreset1280x720, AVCaptureSessionPreset640x480 ];
    case DocumentKitCameraViewVideoQuality::Low:
      return @[ AVCaptureSessionPreset640x480 ];
  }
}

/// How far the phone is turned clockwise when this screen orientation shows upright.
static int DocumentKitInterfaceDegrees(UIInterfaceOrientation orientation)
{
  switch (orientation) {
    case UIInterfaceOrientationLandscapeLeft:
      return 90;
    case UIInterfaceOrientationPortraitUpsideDown:
      return 180;
    case UIInterfaceOrientationLandscapeRight:
      return 270;
    default:
      return 0;
  }
}

/// Captures are saved upright for how the phone is held, whatever the screen does;
/// the preview follows the screen (the same mapping, with the screen's degrees).
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
static AVCaptureVideoOrientation DocumentKitVideoOrientation(int degrees)
{
  switch (degrees) {
    case 90:
      return AVCaptureVideoOrientationLandscapeLeft;
    case 180:
      return AVCaptureVideoOrientationPortraitUpsideDown;
    case 270:
      return AVCaptureVideoOrientationLandscapeRight;
    default:
      return AVCaptureVideoOrientationPortrait;
  }
}

/// Upright, not mirrored: front-camera text in documents reads correctly
/// (the preview layer itself stays mirrored).
static void DocumentKitPrepareConnection(AVCaptureConnection *_Nullable connection, int degrees)
{
  if (connection == nil) {
    return;
  }
  if (connection.isVideoOrientationSupported) {
    connection.videoOrientation = DocumentKitVideoOrientation(degrees);
  }
  if (connection.isVideoMirroringSupported) {
    connection.automaticallyAdjustsVideoMirroring = NO;
    connection.videoMirrored = NO;
  }
}
#pragma clang diagnostic pop

/// First frame at about screen size, upright. Background queue.
static NSURL *_Nullable DocumentKitWriteVideoPoster(NSURL *videoURL, CGFloat maxPixels, NSError **error)
{
  AVAssetImageGenerator *generator = [AVAssetImageGenerator assetImageGeneratorWithAsset:[AVURLAsset assetWithURL:videoURL]];
  generator.appliesPreferredTrackTransform = YES;
  generator.maximumSize = CGSizeMake(maxPixels, maxPixels);
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
  CGImageRef frame = [generator copyCGImageAtTime:kCMTimeZero actualTime:NULL error:error];
#pragma clang diagnostic pop
  if (frame == NULL) {
    return nil;
  }
  NSURL *url = [DocumentKitPhotoEditor writeJPEG:frame prefix:@"VideoPoster" error:error];
  CGImageRelease(frame);
  return url;
}

/// Keeps one photo capture's delegate alive until its data arrives.
@interface DocumentKitPhotoCapture : NSObject <AVCapturePhotoCaptureDelegate>
- (instancetype)initWithCompletion:(void (^)(NSData *_Nullable data, NSError *_Nullable error))completion;
@end

@implementation DocumentKitPhotoCapture {
  void (^_completion)(NSData *_Nullable, NSError *_Nullable);
}

- (instancetype)initWithCompletion:(void (^)(NSData *_Nullable, NSError *_Nullable))completion
{
  if (self = [super init]) {
    _completion = [completion copy];
  }
  return self;
}

- (void)captureOutput:(AVCapturePhotoOutput *)output
    didFinishProcessingPhoto:(AVCapturePhoto *)photo
                       error:(nullable NSError *)error
{
  _completion(error == nil ? photo.fileDataRepresentation : nil, error);
}

@end

/// Backed by the preview layer, so the preview always fills the view.
@interface DocumentKitCameraPreviewView : UIView
@property (nonatomic, readonly) AVCaptureVideoPreviewLayer *previewLayer;
@end

@implementation DocumentKitCameraPreviewView

+ (Class)layerClass
{
  return AVCaptureVideoPreviewLayer.class;
}

- (AVCaptureVideoPreviewLayer *)previewLayer
{
  return (AVCaptureVideoPreviewLayer *)self.layer;
}

@end

@interface DocumentKitCameraViewComponentView () <RCTDocumentKitCameraViewViewProtocol>
@end

/**
 * Blocks on the camera queue promote weakSelf to a strong reference while they
 * run. If the view goes away meanwhile, that reference is the last one, and a
 * UIView must not be deallocated off the main thread. This hands it to the main
 * queue when the block's scope ends (early returns included), so it is released
 * there instead.
 */
static void DocumentKitReleaseOnMain(DocumentKitCameraViewComponentView *__strong *view)
{
  if (*view == nil) {
    return;
  }
  __block DocumentKitCameraViewComponentView *owner = *view;
  *view = nil;
  dispatch_async(dispatch_get_main_queue(), ^{
    owner = nil;
  });
}

/// For `DOCUMENTKIT_RELEASED_ON_MAIN DocumentKitCameraViewComponentView *strongSelf = weakSelf;` in blocks that may run off the main thread.
#define DOCUMENTKIT_RELEASED_ON_MAIN __attribute__((cleanup(DocumentKitReleaseOnMain)))

@implementation DocumentKitCameraViewComponentView {
  // Main thread.
  DocumentKitCameraPreviewView *_previewView;
  NSString *_cameraId;
  DocumentKitCameraViewCameraPosition _position;
  DocumentKitCameraViewMode _mode;
  DocumentKitCameraViewVideoQuality _videoQuality;
  int _videoBitRateKbps;
  BOOL _isTorchOn;
  BOOL _isActive;
  BOOL _isCapturing;
  BOOL _isRecording;
  CGFloat _pinchStartZoom;
  UIPinchGestureRecognizer *_pinch;
  CGFloat _displayZoom;
  UIEdgeInsets _reportedInsets;
  CMMotionManager *_motionManager;
  NSTimer *_progressTimer;
  UIImpactFeedbackGenerator *_haptics;
  // Written on the main thread, read on the camera queue.
  std::atomic<int> _orientationDegrees;
  // Main thread: the screen's orientation (iPad and apps that rotate) and what JS last got.
  int _interfaceDegrees;
  int _reportedDegrees;
  // Bumped on recycle, so a session handed over late is not attached to the next mount.
  std::atomic<int> _mountGeneration;
  // Written on the main thread, read on the camera queue: the torch JS asked for.
  std::atomic<bool> _wantsTorch;

  // Camera queue only (DocumentKitCameraQueue): every session call blocks,
  // startRunning for hundreds of ms, so none runs on the main thread.
  AVCaptureSession *_session;
  AVCaptureDeviceInput *_input;
  AVCaptureDeviceInput *_audioInput;
  AVCapturePhotoOutput *_photoOutput;
  AVCaptureMovieFileOutput *_movieOutput;
  BOOL _hasConfiguredMode;
  DocumentKitCameraViewMode _configuredMode;
  DocumentKitCameraViewVideoQuality _configuredQuality;
  int _configuredBitRateKbps;
  CGFloat _wideZoomFactor;
  CGFloat _reportedZoom;
  DocumentKitCameraRecorder *_recorder;
  NSMutableSet<DocumentKitPhotoCapture *> *_photoCaptures;
}

// Needed because of this: https://github.com/facebook/react-native/pull/37274
+ (void)load
{
  [super load];
}

/// Mounted views by the `cameraId` JS gave them, so DocumentKitCamera calls reach the right camera. Main thread.
+ (NSMapTable<NSString *, DocumentKitCameraViewComponentView *> *)registry
{
  static NSMapTable *registry;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    registry = [NSMapTable strongToWeakObjectsMapTable];
  });
  return registry;
}

+ (nullable instancetype)viewForCameraId:(NSString *)cameraId
{
  return [self.registry objectForKey:cameraId];
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    static const auto defaultProps = std::make_shared<const DocumentKitCameraViewProps>();
    _props = defaultProps;
    _position = defaultProps->cameraPosition;
    _mode = defaultProps->mode;
    _videoQuality = defaultProps->videoQuality;
    _videoBitRateKbps = defaultProps->videoBitRateKbps;
    _isTorchOn = defaultProps->torch;
    _isActive = defaultProps->isActive;
    _displayZoom = 1;
    _orientationDegrees = 0;
    _interfaceDegrees = 0;
    _reportedDegrees = 0;
    _mountGeneration = 0;
    _wantsTorch = false;
    _reportedInsets = UIEdgeInsetsMake(-1, -1, -1, -1);
    _haptics = [[UIImpactFeedbackGenerator alloc] initWithStyle:UIImpactFeedbackStyleLight];
    _photoCaptures = [NSMutableSet new];

    _previewView = [DocumentKitCameraPreviewView new];
    _previewView.previewLayer.videoGravity = AVLayerVideoGravityResizeAspectFill;
    self.contentView = _previewView;
    [self addGestureRecognizers];
  }
  return self;
}

- (void)dealloc
{
  [NSNotificationCenter.defaultCenter removeObserver:self];
  [_motionManager stopAccelerometerUpdates];
  [_progressTimer invalidate];
  AVCaptureSession *session = _session;
  DocumentKitCameraRecorder *recorder = _recorder;
  dispatch_async(DocumentKitCameraQueue(), ^{
    [recorder cancel];
    [session stopRunning];
  });
}

#pragma mark - RCTComponentViewProtocol

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<DocumentKitCameraViewComponentDescriptor>();
}

- (void)updateProps:(const Props::Shared &)props oldProps:(const Props::Shared &)oldProps
{
  const auto &newProps = *std::static_pointer_cast<const DocumentKitCameraViewProps>(props);
  NSString *cameraId = [NSString stringWithUTF8String:newProps.cameraId.c_str()];
  if (![cameraId isEqualToString:_cameraId]) {
    [self unregister];
    _cameraId = cameraId;
    if (cameraId.length > 0) {
      [DocumentKitCameraViewComponentView.registry setObject:self forKey:cameraId];
    }
  }
  _position = newProps.cameraPosition;
  _mode = newProps.mode;
  _videoQuality = newProps.videoQuality;
  _videoBitRateKbps = newProps.videoBitRateKbps;
  _isTorchOn = newProps.torch;
  _isActive = newProps.isActive;
  _pinch.enabled = newProps.isZoomEnabled;
  [super updateProps:props oldProps:oldProps];
  [self updateSession];
}

- (void)prepareForRecycle
{
  [super prepareForRecycle];
  // Recycled views give the camera up; the next mount takes a new session.
  [self unregister];
  _cameraId = nil;
  [self stopOrientationUpdates];
  [_progressTimer invalidate];
  _progressTimer = nil;
  _isCapturing = NO;
  _isRecording = NO;
  // JS starts the next mount with upright icons.
  _reportedDegrees = 0;
  _mountGeneration += 1;
  _reportedInsets = UIEdgeInsetsMake(-1, -1, -1, -1);
  _previewView.previewLayer.connection.enabled = YES;
  _previewView.previewLayer.session = nil;
  __weak __typeof(self) weakSelf = self;
  dispatch_async(DocumentKitCameraQueue(), ^{
    DOCUMENTKIT_RELEASED_ON_MAIN DocumentKitCameraViewComponentView *strongSelf = weakSelf;
    [strongSelf releaseSession];
  });
}

- (void)didMoveToWindow
{
  [super didMoveToWindow];
  [self updateSession];
  [self updateInterfaceOrientation];
}

- (void)layoutSubviews
{
  [super layoutSubviews];
  [self reportSafeArea];
  // A rotating screen (iPad, apps that allow landscape) relayouts this view.
  [self updateInterfaceOrientation];
}

- (void)safeAreaInsetsDidChange
{
  [super safeAreaInsetsDidChange];
  [self reportSafeArea];
}

- (void)unregister
{
  if (_cameraId != nil && [DocumentKitCameraViewComponentView.registry objectForKey:_cameraId] == self) {
    [DocumentKitCameraViewComponentView.registry removeObjectForKey:_cameraId];
  }
}

#pragma mark - Session

/// Runs the camera while the view is on screen and active. iOS itself pauses
/// the session in the background and resumes it in the foreground.
- (void)updateSession
{
  BOOL shouldRun = self.window != nil && _isActive;
  if (shouldRun) {
    [self startOrientationUpdates];
  } else {
    [self stopOrientationUpdates];
  }
  AVCaptureDevicePosition position =
      _position == DocumentKitCameraViewCameraPosition::Front ? AVCaptureDevicePositionFront : AVCaptureDevicePositionBack;
  DocumentKitCameraViewMode mode = _mode;
  DocumentKitCameraViewVideoQuality quality = _videoQuality;
  int bitRateKbps = _videoBitRateKbps;
  BOOL isTorchOn = _isTorchOn;
  _wantsTorch = isTorchOn && mode == DocumentKitCameraViewMode::Video;
  __weak __typeof(self) weakSelf = self;
  dispatch_async(DocumentKitCameraQueue(), ^{
    DOCUMENTKIT_RELEASED_ON_MAIN DocumentKitCameraViewComponentView *strongSelf = weakSelf;
    if (strongSelf == nil) {
      return;
    }
    if (!shouldRun) {
      if (strongSelf->_session.isRunning) {
        [strongSelf->_session stopRunning];
      }
      return;
    }
    if (strongSelf->_session == nil) {
      [strongSelf takeSessionForPosition:position];
    }
    BOOL didSwitch = NO;
    if (![strongSelf useCameraAtPosition:position didSwitch:&didSwitch]) {
      return;
    }
    // A running recording keeps its settings; JS hides mode and quality changes meanwhile.
    if (strongSelf->_recorder == nil) {
      [strongSelf configureMode:mode quality:quality bitRateKbps:bitRateKbps];
    }
    [strongSelf applyTorch:isTorchOn && mode == DocumentKitCameraViewMode::Video];
    if (!strongSelf->_session.isRunning) {
      [strongSelf->_session startRunning];
    } else if (didSwitch) {
      // The running session does not restart on a switch, so report the new camera here.
      [strongSelf emitPreviewStarted];
    }
  });
}

/// Camera queue only. Takes the pre-warmed session when there is one (its camera
/// input already added), otherwise starts an empty one, then adds the outputs.
- (void)takeSessionForPosition:(AVCaptureDevicePosition)position
{
  AVCaptureSession *session = [DocumentKitCameraSessions takeSessionForPosition:position];
  if (session != nil) {
    _input = (AVCaptureDeviceInput *)session.inputs.firstObject;
  } else {
    session = [AVCaptureSession new];
  }
  _session = session;
  _hasConfiguredMode = NO;

  // Photo and video outputs both stay attached, so switching mode is a preset change, not a rebuild.
  [session beginConfiguration];
  AVCapturePhotoOutput *photoOutput = [AVCapturePhotoOutput new];
  if ([session canAddOutput:photoOutput]) {
    [session addOutput:photoOutput];
    _photoOutput = photoOutput;
  }
  AVCaptureMovieFileOutput *movieOutput = [AVCaptureMovieFileOutput new];
  if ([session canAddOutput:movieOutput]) {
    [session addOutput:movieOutput];
    _movieOutput = movieOutput;
  }
  [session commitConfiguration];

  NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
  // Also fires when iOS resumes the session after the app returns to the foreground.
  [center addObserver:self
             selector:@selector(sessionDidStartRunning:)
                 name:AVCaptureSessionDidStartRunningNotification
               object:session];
  [center addObserver:self
             selector:@selector(sessionRuntimeError:)
                 name:AVCaptureSessionRuntimeErrorNotification
               object:session];
  // Split View / Slide Over, a call or another app taking the camera: iOS pauses
  // the session and resumes it later; JS shows that it is paused meanwhile.
  [center addObserver:self
             selector:@selector(sessionWasInterrupted:)
                 name:AVCaptureSessionWasInterruptedNotification
               object:session];
  [center addObserver:self
             selector:@selector(sessionInterruptionEnded:)
                 name:AVCaptureSessionInterruptionEndedNotification
               object:session];

  int generation = _mountGeneration.load();
  __weak __typeof(self) weakSelf = self;
  dispatch_async(dispatch_get_main_queue(), ^{
    DOCUMENTKIT_RELEASED_ON_MAIN DocumentKitCameraViewComponentView *strongSelf = weakSelf;
    if (strongSelf == nil || strongSelf->_mountGeneration.load() != generation) {
      // Recycled meanwhile: this session is being released and must not stick to the view.
      return;
    }
    strongSelf->_previewView.previewLayer.session = session;
    // The preview connection exists only now; turn it to match the screen.
    [strongSelf updateInterfaceOrientation];
  });
}

/// Camera queue only.
- (void)releaseSession
{
  [_recorder cancel];
  _recorder = nil;
  if (_session == nil) {
    return;
  }
  [NSNotificationCenter.defaultCenter removeObserver:self name:nil object:_session];
  [_session stopRunning];
  _session = nil;
  _input = nil;
  _audioInput = nil;
  _photoOutput = nil;
  _movieOutput = nil;
  _hasConfiguredMode = NO;
  _wideZoomFactor = 0;
}

/// Camera queue only. Returns NO (after reporting the error) when no camera could be used.
- (BOOL)useCameraAtPosition:(AVCaptureDevicePosition)position didSwitch:(BOOL *)didSwitch
{
  if (_input != nil && _input.device.position == position) {
    if (_wideZoomFactor == 0) {
      [self resetZoomForDevice:_input.device];
    }
    return YES;
  }
  AVCaptureDevice *device = DocumentKitCameraDevice(position);
  if (device == nil) {
    [self emitError:DocumentKitCameraErrorNoDevice message:@"No camera at this position"];
    return NO;
  }
  NSError *error = nil;
  AVCaptureDeviceInput *input = [AVCaptureDeviceInput deviceInputWithDevice:device error:&error];
  if (input == nil) {
    [self emitError:DocumentKitCameraErrorSessionFailed message:error.localizedDescription ?: @"Camera input failed"];
    return NO;
  }

  [_session beginConfiguration];
  if (_input != nil) {
    [_session removeInput:_input];
  }
  BOOL isAdded = [_session canAddInput:input];
  if (isAdded) {
    [_session addInput:input];
    *didSwitch = _input != nil;
    _input = input;
    // The new camera may not support the current preset; configureMode sets it again.
    _hasConfiguredMode = NO;
  } else if (_input != nil) {
    [_session addInput:_input];
  }
  [_session commitConfiguration];

  if (!isAdded) {
    [self emitError:DocumentKitCameraErrorSessionFailed message:@"Camera input not accepted by the session"];
    return NO;
  }
  [self resetZoomForDevice:device];
  return YES;
}

/// Camera queue only. Photo: full-resolution preset, no microphone. Video: the
/// tier's preset (next lower when unsupported), the microphone when allowed, H.264
/// at the tier's bitrate.
- (void)configureMode:(DocumentKitCameraViewMode)mode
              quality:(DocumentKitCameraViewVideoQuality)quality
          bitRateKbps:(int)bitRateKbps
{
  if (_hasConfiguredMode && mode == _configuredMode && quality == _configuredQuality &&
      bitRateKbps == _configuredBitRateKbps) {
    return;
  }
  BOOL isVideo = mode == DocumentKitCameraViewMode::Video;
  [_session beginConfiguration];
  NSArray<AVCaptureSessionPreset> *presets = isVideo ? DocumentKitVideoPresets(quality) : @[ AVCaptureSessionPresetPhoto ];
  for (AVCaptureSessionPreset preset in [presets arrayByAddingObject:AVCaptureSessionPresetHigh]) {
    if ([_session canSetSessionPreset:preset]) {
      _session.sessionPreset = preset;
      break;
    }
  }
  // The microphone only in video mode, so photo mode never interrupts the user's audio.
  BOOL wantsAudio = isVideo &&
      [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio] == AVAuthorizationStatusAuthorized;
  if (wantsAudio && _audioInput == nil) {
    AVCaptureDevice *microphone = [AVCaptureDevice defaultDeviceWithMediaType:AVMediaTypeAudio];
    AVCaptureDeviceInput *audioInput = microphone ? [AVCaptureDeviceInput deviceInputWithDevice:microphone error:nil] : nil;
    if (audioInput != nil && [_session canAddInput:audioInput]) {
      [_session addInput:audioInput];
      _audioInput = audioInput;
    }
  } else if (!wantsAudio && _audioInput != nil) {
    [_session removeInput:_audioInput];
    _audioInput = nil;
  }
  [_session commitConfiguration];

  AVCaptureConnection *videoConnection = [_movieOutput connectionWithMediaType:AVMediaTypeVideo];
  if (isVideo && videoConnection != nil) {
    NSMutableDictionary *settings = [NSMutableDictionary new];
    // H.264 plays on every server, browser and device.
    if ([_movieOutput.availableVideoCodecTypes containsObject:AVVideoCodecTypeH264]) {
      settings[AVVideoCodecKey] = AVVideoCodecTypeH264;
    }
    if (bitRateKbps > 0 &&
        [[_movieOutput supportedOutputSettingsKeysForConnection:videoConnection]
            containsObject:AVVideoCompressionPropertiesKey]) {
      settings[AVVideoCompressionPropertiesKey] = @{AVVideoAverageBitRateKey : @(bitRateKbps * 1000)};
    }
    [_movieOutput setOutputSettings:settings forConnection:videoConnection];
  }
  if (!isVideo && _photoOutput != nil) {
    // Latency first: the photo is still full resolution, only the processing is quicker.
    _photoOutput.maxPhotoQualityPrioritization = AVCapturePhotoQualityPrioritizationBalanced;
    if (@available(iOS 17.0, *)) {
      if (_photoOutput.isResponsiveCaptureSupported) {
        _photoOutput.responsiveCaptureEnabled = YES;
      }
      if (_photoOutput.isFastCapturePrioritizationSupported) {
        _photoOutput.fastCapturePrioritizationEnabled = YES;
      }
    }
  }

  _hasConfiguredMode = YES;
  _configuredMode = mode;
  _configuredQuality = quality;
  _configuredBitRateKbps = bitRateKbps;
}

/// Camera queue only.
- (void)applyTorch:(BOOL)isOn
{
  AVCaptureDevice *device = _input.device;
  AVCaptureTorchMode torchMode = isOn ? AVCaptureTorchModeOn : AVCaptureTorchModeOff;
  if (device == nil || !device.hasTorch || device.torchMode == torchMode || ![device isTorchModeSupported:torchMode]) {
    return;
  }
  if ([device lockForConfiguration:nil]) {
    device.torchMode = torchMode;
    [device unlockForConfiguration];
  }
}

- (void)sessionDidStartRunning:(NSNotification *)notification
{
  // Frames reach the preview layer right after this; there is no per-frame callback for it.
  __weak __typeof(self) weakSelf = self;
  dispatch_async(DocumentKitCameraQueue(), ^{
    DOCUMENTKIT_RELEASED_ON_MAIN DocumentKitCameraViewComponentView *strongSelf = weakSelf;
    // A torch set before the session ran (or across an interruption) is lost when it starts.
    [strongSelf applyTorch:strongSelf != nil && strongSelf->_wantsTorch.load()];
    [strongSelf emitPreviewStarted];
  });
}

- (void)sessionRuntimeError:(NSNotification *)notification
{
  NSError *error = notification.userInfo[AVCaptureSessionErrorKey];
  AVCaptureSession *session = notification.object;
  if (error.code == AVErrorMediaServicesWereReset && [session isKindOfClass:AVCaptureSession.class]) {
    // The system restarted its media services: start again rather than fail.
    dispatch_async(DocumentKitCameraQueue(), ^{
      if (!session.isRunning) {
        [session startRunning];
      }
    });
    return;
  }
  [self emitError:DocumentKitCameraErrorSessionFailed message:error.localizedDescription ?: @"Camera session failed"];
}

- (void)sessionWasInterrupted:(NSNotification *)notification
{
  NSInteger reason = [notification.userInfo[AVCaptureSessionInterruptionReasonKey] integerValue];
  NSString *name;
  switch (reason) {
    case AVCaptureSessionInterruptionReasonVideoDeviceNotAvailableInBackground:
      // The app left the screen; nothing to show.
      return;
    case AVCaptureSessionInterruptionReasonVideoDeviceNotAvailableWithMultipleForegroundApps:
      name = @"multitasking";
      break;
    case AVCaptureSessionInterruptionReasonVideoDeviceInUseByAnotherClient:
    case AVCaptureSessionInterruptionReasonAudioDeviceInUseByAnotherClient:
      name = @"in_use";
      break;
    default:
      name = @"other";
      break;
  }
  [self emitInterruption:YES reason:name];
}

- (void)sessionInterruptionEnded:(NSNotification *)notification
{
  [self emitInterruption:NO reason:@""];
}

- (void)emitInterruption:(BOOL)isInterrupted reason:(NSString *)reason
{
  if (_eventEmitter) {
    std::static_pointer_cast<const DocumentKitCameraViewEventEmitter>(_eventEmitter)
        ->onInterruption({.isInterrupted = static_cast<bool>(isInterrupted), .reason = std::string(reason.UTF8String)});
  }
}

#pragma mark - Zoom and focus

/// Camera queue only. Starts each camera at the wide-angle lens ("1×").
- (void)resetZoomForDevice:(AVCaptureDevice *)device
{
  _wideZoomFactor = DocumentKitWideZoomFactor(device);
  _reportedZoom = 0;
  [self setZoomFactor:_wideZoomFactor ramp:NO];
}

/// Camera queue only. `factor` in the device's terms (1 = its widest lens).
- (void)setZoomFactor:(CGFloat)factor ramp:(BOOL)ramp
{
  AVCaptureDevice *device = _input.device;
  if (device == nil || _wideZoomFactor == 0) {
    return;
  }
  CGFloat maxFactor = MIN(device.maxAvailableVideoZoomFactor, _wideZoomFactor * DocumentKitMaxDisplayZoom);
  CGFloat clamped = MAX(device.minAvailableVideoZoomFactor, MIN(factor, maxFactor));
  if ([device lockForConfiguration:nil]) {
    if (ramp) {
      [device rampToVideoZoomFactor:clamped withRate:8];
    } else {
      device.videoZoomFactor = clamped;
    }
    [device unlockForConfiguration];
  }
  CGFloat zoom = clamped / _wideZoomFactor;
  if (_reportedZoom == 0 || fabs(zoom - _reportedZoom) >= DocumentKitZoomReportStep) {
    _reportedZoom = zoom;
    [self emitZoom:zoom minZoom:device.minAvailableVideoZoomFactor / _wideZoomFactor maxZoom:maxFactor / _wideZoomFactor];
  }
}

- (void)setZoom:(double)zoom
{
  __weak __typeof(self) weakSelf = self;
  dispatch_async(DocumentKitCameraQueue(), ^{
    DOCUMENTKIT_RELEASED_ON_MAIN DocumentKitCameraViewComponentView *strongSelf = weakSelf;
    if (strongSelf != nil) {
      [strongSelf setZoomFactor:zoom * strongSelf->_wideZoomFactor ramp:YES];
    }
  });
}

- (void)addGestureRecognizers
{
  _pinch = [[UIPinchGestureRecognizer alloc] initWithTarget:self action:@selector(handlePinch:)];
  [_previewView addGestureRecognizer:_pinch];
  [_previewView addGestureRecognizer:[[UITapGestureRecognizer alloc] initWithTarget:self
                                                                             action:@selector(handleTap:)]];
  for (NSNumber *direction in @[ @(UISwipeGestureRecognizerDirectionLeft), @(UISwipeGestureRecognizerDirectionRight) ]) {
    UISwipeGestureRecognizer *swipe = [[UISwipeGestureRecognizer alloc] initWithTarget:self
                                                                                action:@selector(handleSwipe:)];
    swipe.direction = (UISwipeGestureRecognizerDirection)direction.unsignedIntegerValue;
    [_previewView addGestureRecognizer:swipe];
  }
}

- (void)handlePinch:(UIPinchGestureRecognizer *)pinch
{
  if (pinch.state == UIGestureRecognizerStateBegan) {
    _pinchStartZoom = _displayZoom;
  } else if (pinch.state == UIGestureRecognizerStateChanged) {
    CGFloat zoom = _pinchStartZoom * pinch.scale;
    __weak __typeof(self) weakSelf = self;
    dispatch_async(DocumentKitCameraQueue(), ^{
      DOCUMENTKIT_RELEASED_ON_MAIN DocumentKitCameraViewComponentView *strongSelf = weakSelf;
      if (strongSelf != nil) {
        [strongSelf setZoomFactor:zoom * strongSelf->_wideZoomFactor ramp:NO];
      }
    });
  }
}

- (void)handleTap:(UITapGestureRecognizer *)tap
{
  CGPoint point = [_previewView.previewLayer captureDevicePointOfInterestForPoint:[tap locationInView:_previewView]];
  __weak __typeof(self) weakSelf = self;
  dispatch_async(DocumentKitCameraQueue(), ^{
    DOCUMENTKIT_RELEASED_ON_MAIN DocumentKitCameraViewComponentView *strongSelf = weakSelf;
    AVCaptureDevice *device = strongSelf != nil ? strongSelf->_input.device : nil;
    if (device == nil || ![device lockForConfiguration:nil]) {
      return;
    }
    if (device.isFocusPointOfInterestSupported && [device isFocusModeSupported:AVCaptureFocusModeAutoFocus]) {
      device.focusPointOfInterest = point;
      device.focusMode = AVCaptureFocusModeAutoFocus;
    }
    if (device.isExposurePointOfInterestSupported && [device isExposureModeSupported:AVCaptureExposureModeAutoExpose]) {
      device.exposurePointOfInterest = point;
      device.exposureMode = AVCaptureExposureModeAutoExpose;
    }
    [device unlockForConfiguration];
  });
}

- (void)handleSwipe:(UISwipeGestureRecognizer *)swipe
{
  if (_eventEmitter) {
    std::string direction = swipe.direction == UISwipeGestureRecognizerDirectionLeft ? "left" : "right";
    std::static_pointer_cast<const DocumentKitCameraViewEventEmitter>(_eventEmitter)->onSwipe({.direction = direction});
  }
}

#pragma mark - Orientation

/// The accelerometer, not UIDevice, so it still works with the rotation lock on (as on Android).
- (void)startOrientationUpdates
{
  if (_motionManager != nil) {
    return;
  }
  _motionManager = [CMMotionManager new];
  if (!_motionManager.isAccelerometerAvailable) {
    return;
  }
  _motionManager.accelerometerUpdateInterval = 0.2;
  __weak __typeof(self) weakSelf = self;
  [_motionManager startAccelerometerUpdatesToQueue:NSOperationQueue.mainQueue
                                       withHandler:^(CMAccelerometerData *data, NSError *error) {
                                         if (data != nil) {
                                           [weakSelf updateOrientationWithX:data.acceleration.x y:data.acceleration.y];
                                         }
                                       }];
}

- (void)stopOrientationUpdates
{
  [_motionManager stopAccelerometerUpdates];
  _motionManager = nil;
}

- (void)updateOrientationWithX:(double)x y:(double)y
{
  int degrees;
  if (y < -DocumentKitOrientationThreshold) {
    degrees = 0;
  } else if (x > DocumentKitOrientationThreshold) {
    // Right edge down: turned 90° clockwise.
    degrees = 90;
  } else if (y > DocumentKitOrientationThreshold) {
    degrees = 180;
  } else if (x < -DocumentKitOrientationThreshold) {
    degrees = 270;
  } else {
    // Flat or in between: keep the last one.
    return;
  }
  _orientationDegrees = degrees;
  // Also catches a 180° screen turn, which changes no size and so triggers no layout.
  [self updateInterfaceOrientation];
}

/// Turns the preview to the screen and tells JS how far to turn its icons. Main thread.
- (void)updateInterfaceOrientation
{
  UIInterfaceOrientation orientation = self.window.windowScene.interfaceOrientation;
  if (orientation == UIInterfaceOrientationUnknown) {
    // Not in a window yet.
    return;
  }
  _interfaceDegrees = DocumentKitInterfaceDegrees(orientation);
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
  AVCaptureConnection *connection = _previewView.previewLayer.connection;
  AVCaptureVideoOrientation previewOrientation = DocumentKitVideoOrientation(_interfaceDegrees);
  if (connection.isVideoOrientationSupported && connection.videoOrientation != previewOrientation) {
    connection.videoOrientation = previewOrientation;
  }
#pragma clang diagnostic pop

  // Relative to the screen: 0 whenever the screen already turned with the phone.
  int degrees = (_orientationDegrees.load() - _interfaceDegrees + 360) % 360;
  // Without an emitter yet, the next update reports it.
  if (degrees == _reportedDegrees || !_eventEmitter) {
    return;
  }
  _reportedDegrees = degrees;
  std::static_pointer_cast<const DocumentKitCameraViewEventEmitter>(_eventEmitter)->onOrientationChanged({.degrees = degrees});
}

#pragma mark - Photo

- (void)takePhotoWithFlash:(NSString *)flash completion:(DocumentKitCameraCompletion)completion
{
  if (_isCapturing || _isRecording) {
    completion(nil, DocumentKitCodeBusy, @"The camera is already capturing");
    return;
  }
  _isCapturing = YES;
  [_haptics impactOccurred];
  // Freezes the preview on the shot until the review shows or resumePreview.
  _previewView.previewLayer.connection.enabled = NO;
  AVCaptureFlashMode flashMode = [flash isEqualToString:@"on"] ? AVCaptureFlashModeOn
      : [flash isEqualToString:@"auto"]                       ? AVCaptureFlashModeAuto
                                                              : AVCaptureFlashModeOff;
  int degrees = _orientationDegrees.load();
  CGFloat maxPixels = MAX(UIScreen.mainScreen.nativeBounds.size.width, UIScreen.mainScreen.nativeBounds.size.height);

  __weak __typeof(self) weakSelf = self;
  void (^finish)(NSDictionary *, NSString *, NSString *) = ^(NSDictionary *file, NSString *code, NSString *message) {
    dispatch_async(dispatch_get_main_queue(), ^{
      DOCUMENTKIT_RELEASED_ON_MAIN DocumentKitCameraViewComponentView *strongSelf = weakSelf;
      if (strongSelf != nil) {
        strongSelf->_isCapturing = NO;
        if (file == nil) {
          strongSelf->_previewView.previewLayer.connection.enabled = YES;
        }
      }
      completion(file, code, message);
    });
  };

  dispatch_async(DocumentKitCameraQueue(), ^{
    DOCUMENTKIT_RELEASED_ON_MAIN DocumentKitCameraViewComponentView *strongSelf = weakSelf;
    AVCapturePhotoOutput *output = strongSelf != nil ? strongSelf->_photoOutput : nil;
    if (output == nil || !strongSelf->_session.isRunning || !strongSelf->_hasConfiguredMode ||
        strongSelf->_configuredMode != DocumentKitCameraViewMode::Photo) {
      finish(nil, DocumentKitCodeNotReady, @"The photo camera is not running");
      return;
    }
    DocumentKitPrepareConnection([output connectionWithMediaType:AVMediaTypeVideo], degrees);
    AVCapturePhotoSettings *settings = [output.availablePhotoCodecTypes containsObject:AVVideoCodecTypeJPEG]
        ? [AVCapturePhotoSettings photoSettingsWithFormat:@{AVVideoCodecKey : AVVideoCodecTypeJPEG}]
        : [AVCapturePhotoSettings photoSettings];
    if ([output.supportedFlashModes containsObject:@(flashMode)]) {
      settings.flashMode = flashMode;
    }
    settings.photoQualityPrioritization = AVCapturePhotoQualityPrioritizationBalanced;

    __block DocumentKitPhotoCapture *capture = nil;
    capture = [[DocumentKitPhotoCapture alloc] initWithCompletion:^(NSData *data, NSError *error) {
      // Runs once; clearing the variable breaks the capture ↔ block cycle.
      DocumentKitPhotoCapture *finished = capture;
      capture = nil;
      dispatch_async(DocumentKitCameraQueue(), ^{
        DOCUMENTKIT_RELEASED_ON_MAIN DocumentKitCameraViewComponentView *strongSelf = weakSelf;
        [strongSelf forgetPhotoCapture:finished];
      });
      if (data == nil) {
        finish(nil, DocumentKitCodeCapture, error.localizedDescription ?: @"Capture failed");
        return;
      }
      dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        NSError *fileError = nil;
        NSURL *directory = [DocumentKitFileUtils rootDirectoryWithError:&fileError];
        NSURL *photoURL = [directory URLByAppendingPathComponent:[DocumentKitFileUtils timestampedName:@"Image" extension:@"jpg"]];
        NSURL *displayURL = nil;
        if (photoURL != nil && [data writeToURL:photoURL options:NSDataWritingAtomic error:&fileError]) {
          displayURL = [DocumentKitPhotoEditor writeDisplayCopyOfPhoto:photoURL maxPixels:maxPixels error:&fileError];
        }
        if (displayURL == nil) {
          finish(nil, DocumentKitCodeStorage, fileError.localizedDescription ?: @"Cannot save the photo");
          return;
        }
        NSMutableDictionary *file = [[DocumentKitFileUtils describeFileAtURL:photoURL] mutableCopy];
        file[@"previewUri"] = displayURL.absoluteString;
        finish(file, nil, nil);
      });
    }];
    [strongSelf->_photoCaptures addObject:capture];
    [output capturePhotoWithSettings:settings delegate:capture];
  });
}

/// Camera queue only.
- (void)forgetPhotoCapture:(DocumentKitPhotoCapture *)capture
{
  [_photoCaptures removeObject:capture];
}

- (void)resumePreview
{
  _previewView.previewLayer.connection.enabled = YES;
}

#pragma mark - Video

- (void)startRecordingWithAudio:(BOOL)isAudioEnabled
             maxDurationSeconds:(double)maxDurationSeconds
                     completion:(DocumentKitCameraCompletion)completion
{
  if (_isCapturing || _isRecording) {
    completion(nil, DocumentKitCodeBusy, @"The camera is already capturing");
    return;
  }
  _isRecording = YES;
  [_haptics impactOccurred];
  int degrees = _orientationDegrees.load();
  CGFloat maxPixels = MAX(UIScreen.mainScreen.nativeBounds.size.width, UIScreen.mainScreen.nativeBounds.size.height);

  __weak __typeof(self) weakSelf = self;
  void (^finish)(NSDictionary *, NSString *, NSString *) = ^(NSDictionary *file, NSString *code, NSString *message) {
    dispatch_async(dispatch_get_main_queue(), ^{
      DOCUMENTKIT_RELEASED_ON_MAIN DocumentKitCameraViewComponentView *strongSelf = weakSelf;
      if (strongSelf != nil) {
        strongSelf->_isRecording = NO;
        [strongSelf->_progressTimer invalidate];
        strongSelf->_progressTimer = nil;
        [strongSelf->_haptics impactOccurred];
      }
      completion(file, code, message);
    });
  };

  dispatch_async(DocumentKitCameraQueue(), ^{
    DOCUMENTKIT_RELEASED_ON_MAIN DocumentKitCameraViewComponentView *strongSelf = weakSelf;
    AVCaptureMovieFileOutput *output = strongSelf != nil ? strongSelf->_movieOutput : nil;
    if (output == nil || !strongSelf->_session.isRunning || !strongSelf->_hasConfiguredMode ||
        strongSelf->_configuredMode != DocumentKitCameraViewMode::Video) {
      finish(nil, DocumentKitCodeNotReady, @"The video camera is not running");
      return;
    }
    DocumentKitPrepareConnection([output connectionWithMediaType:AVMediaTypeVideo], degrees);
    [output connectionWithMediaType:AVMediaTypeAudio].enabled = isAudioEnabled;

    DocumentKitCameraRecorder *recorder = [[DocumentKitCameraRecorder alloc]
        initWithOutput:output
        maxDurationSeconds:maxDurationSeconds
                completion:^(NSURL *mp4URL, NSError *error, BOOL isCancelled) {
                  dispatch_async(DocumentKitCameraQueue(), ^{
                    DOCUMENTKIT_RELEASED_ON_MAIN DocumentKitCameraViewComponentView *owner = weakSelf;
                    if (owner != nil) {
                      owner->_recorder = nil;
                    }
                  });
                  if (isCancelled) {
                    finish(nil, DocumentKitCodeCancelled, @"Recording cancelled");
                    return;
                  }
                  if (mp4URL == nil) {
                    finish(nil, DocumentKitCodeCapture, error.localizedDescription ?: @"Recording failed");
                    return;
                  }
                  NSError *posterError = nil;
                  NSURL *posterURL = DocumentKitWriteVideoPoster(mp4URL, maxPixels, &posterError);
                  if (posterURL == nil) {
                    finish(nil, DocumentKitCodeStorage, posterError.localizedDescription ?: @"Cannot read the recording");
                    return;
                  }
                  NSMutableDictionary *file = [[DocumentKitFileUtils describeFileAtURL:mp4URL] mutableCopy];
                  file[@"posterUri"] = posterURL.absoluteString;
                  finish(file, nil, nil);
                }];
    NSError *startError = nil;
    if (![recorder start:&startError]) {
      finish(nil, DocumentKitCodeStorage, startError.localizedDescription ?: @"Cannot create the video file");
      return;
    }
    strongSelf->_recorder = recorder;
    dispatch_async(dispatch_get_main_queue(), ^{
      [weakSelf startProgressTimer];
    });
  });
}

- (void)startProgressTimer
{
  if (!_isRecording) {
    return;
  }
  [_progressTimer invalidate];
  __weak __typeof(self) weakSelf = self;
  _progressTimer = [NSTimer scheduledTimerWithTimeInterval:1
                                                   repeats:YES
                                                     block:^(NSTimer *timer) {
                                                       dispatch_async(DocumentKitCameraQueue(), ^{
                                                         DOCUMENTKIT_RELEASED_ON_MAIN DocumentKitCameraViewComponentView *strongSelf = weakSelf;
                                                         DocumentKitCameraRecorder *recorder =
                                                             strongSelf != nil ? strongSelf->_recorder : nil;
                                                         if (recorder != nil) {
                                                           [strongSelf emitProgressSeconds:recorder.recordedSeconds
                                                                                     bytes:recorder.recordedBytes];
                                                         }
                                                       });
                                                     }];
}

- (void)withRecorder:(void (^)(DocumentKitCameraRecorder *recorder))action
{
  __weak __typeof(self) weakSelf = self;
  dispatch_async(DocumentKitCameraQueue(), ^{
    DOCUMENTKIT_RELEASED_ON_MAIN DocumentKitCameraViewComponentView *strongSelf = weakSelf;
    if (strongSelf != nil && strongSelf->_recorder != nil) {
      action(strongSelf->_recorder);
    }
  });
}

- (void)stopRecording
{
  [self withRecorder:^(DocumentKitCameraRecorder *recorder) {
    [recorder stop];
  }];
}

- (void)pauseRecording
{
  [self withRecorder:^(DocumentKitCameraRecorder *recorder) {
    [recorder pause];
  }];
}

- (void)resumeRecording
{
  [self withRecorder:^(DocumentKitCameraRecorder *recorder) {
    [recorder resume];
  }];
}

- (void)cancelRecording
{
  [self withRecorder:^(DocumentKitCameraRecorder *recorder) {
    [recorder cancel];
  }];
}

#pragma mark - Events

/// Camera queue only (reads the current input).
- (void)emitPreviewStarted
{
  AVCaptureDevice *device = _input.device;
  BOOL hasFlash = device.hasFlash || device.hasTorch;
  __weak __typeof(self) weakSelf = self;
  dispatch_async(dispatch_get_main_queue(), ^{
    DOCUMENTKIT_RELEASED_ON_MAIN DocumentKitCameraViewComponentView *strongSelf = weakSelf;
    if (strongSelf != nil && strongSelf->_eventEmitter) {
      std::static_pointer_cast<const DocumentKitCameraViewEventEmitter>(strongSelf->_eventEmitter)
          ->onPreviewStarted({.hasFlash = static_cast<bool>(hasFlash)});
    }
  });
}

- (void)emitZoom:(CGFloat)zoom minZoom:(CGFloat)minZoom maxZoom:(CGFloat)maxZoom
{
  __weak __typeof(self) weakSelf = self;
  dispatch_async(dispatch_get_main_queue(), ^{
    DOCUMENTKIT_RELEASED_ON_MAIN DocumentKitCameraViewComponentView *strongSelf = weakSelf;
    if (strongSelf == nil) {
      return;
    }
    strongSelf->_displayZoom = zoom;
    if (strongSelf->_eventEmitter) {
      std::static_pointer_cast<const DocumentKitCameraViewEventEmitter>(strongSelf->_eventEmitter)
          ->onZoomChanged({.zoom = static_cast<Float>(zoom),
                           .minZoom = static_cast<Float>(minZoom),
                           .maxZoom = static_cast<Float>(maxZoom)});
    }
  });
}

- (void)emitProgressSeconds:(double)seconds bytes:(double)bytes
{
  __weak __typeof(self) weakSelf = self;
  dispatch_async(dispatch_get_main_queue(), ^{
    DOCUMENTKIT_RELEASED_ON_MAIN DocumentKitCameraViewComponentView *strongSelf = weakSelf;
    if (strongSelf != nil && strongSelf->_eventEmitter) {
      std::static_pointer_cast<const DocumentKitCameraViewEventEmitter>(strongSelf->_eventEmitter)
          ->onRecordingProgress({.seconds = seconds, .bytes = bytes});
    }
  });
}

/// Main thread.
- (void)reportSafeArea
{
  UIEdgeInsets insets = self.safeAreaInsets;
  if (self.window == nil || UIEdgeInsetsEqualToEdgeInsets(insets, _reportedInsets)) {
    return;
  }
  _reportedInsets = insets;
  if (_eventEmitter) {
    std::static_pointer_cast<const DocumentKitCameraViewEventEmitter>(_eventEmitter)
        ->onSafeAreaInsets({.top = insets.top, .right = insets.right, .bottom = insets.bottom, .left = insets.left});
  }
}

- (void)emitError:(NSString *)code message:(NSString *)message
{
  std::string codeValue = code.UTF8String;
  std::string messageValue = message.UTF8String;
  __weak __typeof(self) weakSelf = self;
  dispatch_async(dispatch_get_main_queue(), ^{
    DOCUMENTKIT_RELEASED_ON_MAIN DocumentKitCameraViewComponentView *strongSelf = weakSelf;
    if (strongSelf != nil && strongSelf->_eventEmitter) {
      std::static_pointer_cast<const DocumentKitCameraViewEventEmitter>(strongSelf->_eventEmitter)
          ->onCameraError({.code = codeValue, .message = messageValue});
    }
  });
}

@end
