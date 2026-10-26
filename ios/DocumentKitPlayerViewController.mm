#import "DocumentKitPlayerViewController.h"

#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

static const NSTimeInterval DocumentKitHideControlsDelay = 3;
static const NSTimeInterval DocumentKitFadeDuration = 0.2;
static const NSTimeInterval DocumentKitMessageDuration = 2;
static const CGFloat DocumentKitThumbSize = 14;

static void *DocumentKitTimeControlContext = &DocumentKitTimeControlContext;
static void *DocumentKitItemStatusContext = &DocumentKitItemStatusContext;

/// "00:18", or "1:02:03" past an hour.
static NSString *DocumentKitFormatTime(double seconds)
{
  long total = (long)MAX(0, isfinite(seconds) ? seconds : 0);
  long hours = total / 3600;
  long minutes = (total % 3600) / 60;
  long rest = total % 60;
  return hours > 0 ? [NSString stringWithFormat:@"%ld:%02ld:%02ld", hours, minutes, rest]
                   : [NSString stringWithFormat:@"%02ld:%02ld", minutes, rest];
}

/// "4.2 MB", "740 KB", like the camera's review screen.
static NSString *DocumentKitFormatSize(long long bytes)
{
  if (bytes >= 1024 * 1024) {
    double megabytes = bytes / (1024.0 * 1024.0);
    return megabytes >= 10 ? [NSString stringWithFormat:@"%.0f MB", round(megabytes)]
                           : [NSString stringWithFormat:@"%.1f MB", megabytes];
  }
  return [NSString stringWithFormat:@"%lld KB", MAX(1LL, bytes / 1024)];
}

/// "1x", "1.25x", "0.5x".
static NSString *DocumentKitFormatSpeed(float speed)
{
  return [NSString stringWithFormat:@"%@x", [NSNumber numberWithFloat:speed].stringValue];
}

/// A view whose layer is the AVPlayerLayer, so it resizes with Auto Layout.
@interface DocumentKitPlayerLayerView : UIView
@property (nonatomic, readonly) AVPlayerLayer *playerLayer;
@end

@implementation DocumentKitPlayerLayerView
+ (Class)layerClass
{
  return AVPlayerLayer.class;
}
- (AVPlayerLayer *)playerLayer
{
  return (AVPlayerLayer *)self.layer;
}
@end

/// Dark-to-clear scrim behind the top and bottom controls.
@interface DocumentKitGradientView : UIView
@end

@implementation DocumentKitGradientView
+ (Class)layerClass
{
  return CAGradientLayer.class;
}
- (instancetype)initFromTop:(BOOL)fromTop
{
  if ((self = [super initWithFrame:CGRectZero])) {
    CAGradientLayer *gradient = (CAGradientLayer *)self.layer;
    UIColor *dark = [UIColor colorWithWhite:0 alpha:0.6];
    gradient.colors = fromTop ? @[ (id)dark.CGColor, (id)UIColor.clearColor.CGColor ]
                              : @[ (id)UIColor.clearColor.CGColor, (id)dark.CGColor ];
    self.userInteractionEnabled = NO;
  }
  return self;
}
@end

@interface DocumentKitPlayerViewController () <UIGestureRecognizerDelegate, UIDocumentPickerDelegate>
@end

@implementation DocumentKitPlayerViewController {
  AVURLAsset *_asset;
  NSURL *_mediaURL;
  NSDictionary<NSString *, NSString *> *_headers;
  NSString *_title;
  NSString *_mimeType;
  NSDictionary<NSString *, NSString *> *_labels;
  UIColor *_accentColor;
  BOOL _canSave;

  DocumentKitPlayerLayerView *_playerView;
  UIView *_controls;
  UILabel *_subtitleLabel;
  UILabel *_errorLabel;
  UIStackView *_centerRow;
  UIButton *_playButton;
  UIActivityIndicatorView *_bufferingSpinner;
  UISlider *_slider;
  UILabel *_positionLabel;
  UILabel *_remainingLabel;
  UIButton *_speedButton;
  UIButton *_soundButton;
  UIButton *_fullScreenButton;
  UIButton *_saveButton;
  UIActivityIndicatorView *_saveSpinner;
  UILabel *_messageLabel;

  id _timeObserver;
  // Observers exist only once the view loaded; a player that never showed has none to remove.
  BOOL _isObserving;
  NSArray<NSNumber *> *_speeds;
  NSUInteger _speedIndex;
  NSString *_sizeLabel;
  BOOL _isScrubbing;
  BOOL _isFullScreen;
  BOOL _isRotatedForFullScreen;
  BOOL _areControlsVisible;
  BOOL _hasEnded;
  BOOL _isSaving;
  BOOL _hasReportedDismiss;
  NSString *_finishOutcome;
  NSInteger _finishHttpStatus;
  NSURLSessionDataTask *_statusCheckTask;
  NSURLSessionDownloadTask *_saveTask;
  NSURL *_exportDirectory;
}

- (instancetype)initWithAsset:(AVURLAsset *)asset
                     mediaURL:(NSURL *)mediaURL
                      headers:(NSDictionary<NSString *, NSString *> *)headers
                        title:(NSString *)title
                     mimeType:(NSString *)mimeType
                       labels:(NSDictionary<NSString *, NSString *> *)labels
                  accentColor:(UIColor *)accentColor
                        muted:(BOOL)muted
                      canSave:(BOOL)canSave
{
  if ((self = [super initWithNibName:nil bundle:nil])) {
    _asset = asset;
    _mediaURL = mediaURL;
    _headers = headers;
    _title = title;
    _mimeType = mimeType;
    _labels = labels;
    // DocumentKit's default primaryColor, when the caller passes no theme.
    _accentColor = accentColor ?: [UIColor colorWithRed:0x1C / 255.0 green:0x6F / 255.0 blue:0xE2 / 255.0 alpha:1];
    _canSave = canSave;
    _speeds = @[ @0.5, @0.75, @1, @1.25, @1.5, @2 ];
    _speedIndex = [_speeds indexOfObject:@1];
    _areControlsVisible = YES;
    _finishOutcome = @"closed";
    _autoPlay = YES;
    _skipBackSeconds = 5;
    _skipForwardSeconds = 15;
    _allowSpeed = YES;
    _allowFullScreen = YES;
    _player = [AVPlayer playerWithPlayerItem:[AVPlayerItem playerItemWithAsset:asset]];
    _player.muted = muted;
    self.modalPresentationStyle = UIModalPresentationFullScreen;
    self.modalPresentationCapturesStatusBarAppearance = YES;
  }
  return self;
}

- (void)dealloc
{
  [NSObject cancelPreviousPerformRequestsWithTarget:self];
  [NSNotificationCenter.defaultCenter removeObserver:self];
  if (_isObserving) {
    [_player removeTimeObserver:_timeObserver];
    [_player removeObserver:self forKeyPath:@"timeControlStatus" context:DocumentKitTimeControlContext];
    [_player.currentItem removeObserver:self forKeyPath:@"status" context:DocumentKitItemStatusContext];
  }
  [_saveTask cancel];
  [_statusCheckTask cancel];
  [self removeExportDirectory];
}

- (NSString *)label:(NSString *)key
{
  return _labels[key] ?: @"";
}

/// A skip button's label, with "{seconds}" filled in.
- (NSString *)label:(NSString *)key seconds:(NSInteger)seconds
{
  return [[self label:key] stringByReplacingOccurrencesOfString:@"{seconds}"
                                                     withString:[NSString stringWithFormat:@"%ld", (long)seconds]];
}

/// "gobackward.10" where SF Symbols has the number, else the plain arrow.
- (NSString *)skipSymbol:(NSString *)base seconds:(NSInteger)seconds
{
  NSString *numbered = [NSString stringWithFormat:@"%@.%ld", base, (long)seconds];
  return [UIImage systemImageNamed:numbered] != nil ? numbered : base;
}

#pragma mark - View lifecycle

- (void)viewDidLoad
{
  [super viewDidLoad];
  self.view.backgroundColor = UIColor.blackColor;
  _sizeLabel = [self localSizeLabel];
  [self buildViews];
  [self observePlayer];
  [self updateSoundButton];
  [self updateSpeedButton];
  [self updateFullScreenButton];
  [self updateSubtitle];
  [self updatePlayButton];
  if (self.startPositionMs > 0) {
    [_player seekToTime:CMTimeMakeWithSeconds(self.startPositionMs / 1000.0, NSEC_PER_SEC)
        toleranceBefore:kCMTimeZero
         toleranceAfter:kCMTimeZero];
  }
  if (self.autoPlay) {
    [self playAtCurrentSpeed];
  }
}

- (void)viewDidDisappear:(BOOL)animated
{
  [super viewDidDisappear:animated];
  if (self.isBeingDismissed || self.presentingViewController == nil) {
    [_player pause];
    [_saveTask cancel];
    [_statusCheckTask cancel];
    if (!_hasReportedDismiss && self.onFinish != nil) {
      _hasReportedDismiss = YES;
      double positionMs = CMTimeGetSeconds(_player.currentTime) * 1000;
      self.onFinish(_finishOutcome, isfinite(positionMs) ? positionMs : 0, _finishHttpStatus);
      self.onFinish = nil;
    }
  }
}

- (UIStatusBarStyle)preferredStatusBarStyle
{
  return UIStatusBarStyleLightContent;
}

- (BOOL)prefersStatusBarHidden
{
  return _isFullScreen;
}

- (BOOL)prefersHomeIndicatorAutoHidden
{
  return _isFullScreen;
}

- (UIInterfaceOrientationMask)supportedInterfaceOrientations
{
  if (_isRotatedForFullScreen) {
    return UIInterfaceOrientationMaskLandscape;
  }
  return self.traitCollection.userInterfaceIdiom == UIUserInterfaceIdiomPad ? UIInterfaceOrientationMaskAll
                                                                            : UIInterfaceOrientationMaskAllButUpsideDown;
}

#pragma mark - Layout

- (UIButton *)iconButton:(NSString *)symbol pointSize:(CGFloat)pointSize action:(SEL)action
{
  return [self iconButton:symbol pointSize:pointSize size:44 action:action];
}

- (UIButton *)iconButton:(NSString *)symbol pointSize:(CGFloat)pointSize size:(CGFloat)size action:(SEL)action
{
  UIButton *button = [UIButton buttonWithType:UIButtonTypeSystem];
  button.tintColor = UIColor.whiteColor;
  [self setSymbol:symbol pointSize:pointSize onButton:button];
  [button addTarget:self action:action forControlEvents:UIControlEventTouchUpInside];
  button.translatesAutoresizingMaskIntoConstraints = NO;
  [NSLayoutConstraint activateConstraints:@[
    [button.widthAnchor constraintEqualToConstant:size],
    [button.heightAnchor constraintEqualToConstant:size],
  ]];
  return button;
}

- (void)setSymbol:(NSString *)symbol pointSize:(CGFloat)pointSize onButton:(UIButton *)button
{
  UIImageSymbolConfiguration *configuration = [UIImageSymbolConfiguration configurationWithPointSize:pointSize
                                                                                             weight:UIImageSymbolWeightMedium];
  [button setImage:[UIImage systemImageNamed:symbol withConfiguration:configuration] forState:UIControlStateNormal];
}

- (UILabel *)labelWithSize:(CGFloat)size weight:(UIFontWeight)weight color:(UIColor *)color
{
  UILabel *label = [UILabel new];
  label.font = [UIFont monospacedDigitSystemFontOfSize:size weight:weight];
  label.textColor = color;
  label.translatesAutoresizingMaskIntoConstraints = NO;
  return label;
}

/// Round dark button with the circular arrow SF Symbol that has the seconds written in it.
- (UIButton *)seekButton:(NSString *)symbol label:(NSString *)label action:(SEL)action
{
  UIButton *button = [self iconButton:symbol pointSize:26 size:52 action:action];
  button.backgroundColor = [UIColor colorWithWhite:0 alpha:0.4];
  button.layer.cornerRadius = 26;
  button.accessibilityLabel = label;
  return button;
}

- (void)buildViews
{
  UIView *view = self.view;
  UILayoutGuide *safe = view.safeAreaLayoutGuide;

  _playerView = [DocumentKitPlayerLayerView new];
  _playerView.playerLayer.player = _player;
  _playerView.playerLayer.videoGravity = AVLayerVideoGravityResizeAspect;
  _playerView.translatesAutoresizingMaskIntoConstraints = NO;
  [view addSubview:_playerView];

  _errorLabel = [self labelWithSize:15 weight:UIFontWeightRegular color:UIColor.whiteColor];
  _errorLabel.text = [self label:@"playbackError"];
  _errorLabel.textAlignment = NSTextAlignmentCenter;
  _errorLabel.numberOfLines = 0;
  _errorLabel.hidden = YES;
  [view addSubview:_errorLabel];

  _controls = [UIView new];
  _controls.translatesAutoresizingMaskIntoConstraints = NO;
  [view addSubview:_controls];

  DocumentKitGradientView *topScrim = [[DocumentKitGradientView alloc] initFromTop:YES];
  DocumentKitGradientView *bottomScrim = [[DocumentKitGradientView alloc] initFromTop:NO];
  for (UIView *scrim in @[ topScrim, bottomScrim ]) {
    scrim.translatesAutoresizingMaskIntoConstraints = NO;
    [_controls addSubview:scrim];
  }

  // Top bar: close, title with length and size, Download.
  UIButton *closeButton = [self iconButton:@"xmark" pointSize:18 action:@selector(closeTapped)];
  closeButton.accessibilityLabel = [self label:@"close"];
  UILabel *titleLabel = [self labelWithSize:16 weight:UIFontWeightSemibold color:UIColor.whiteColor];
  titleLabel.text = _title;
  titleLabel.lineBreakMode = NSLineBreakByTruncatingMiddle;
  _subtitleLabel = [self labelWithSize:12 weight:UIFontWeightRegular color:[UIColor colorWithWhite:1 alpha:0.7]];
  UIStackView *titles = [[UIStackView alloc] initWithArrangedSubviews:@[ titleLabel, _subtitleLabel ]];
  titles.axis = UILayoutConstraintAxisVertical;
  titles.spacing = 2;
  UIStackView *topBar = [[UIStackView alloc] initWithArrangedSubviews:@[ closeButton, titles ]];
  topBar.alignment = UIStackViewAlignmentCenter;
  topBar.spacing = 8;
  if (_canSave) {
    _saveButton = [self iconButton:@"arrow.down.to.line" pointSize:18 action:@selector(saveTapped)];
    _saveButton.accessibilityLabel = [self label:@"save"];
    _saveSpinner = [[UIActivityIndicatorView alloc] initWithActivityIndicatorStyle:UIActivityIndicatorViewStyleMedium];
    _saveSpinner.color = UIColor.whiteColor;
    _saveSpinner.translatesAutoresizingMaskIntoConstraints = NO;
    [_saveButton addSubview:_saveSpinner];
    [NSLayoutConstraint activateConstraints:@[
      [_saveSpinner.centerXAnchor constraintEqualToAnchor:_saveButton.centerXAnchor],
      [_saveSpinner.centerYAnchor constraintEqualToAnchor:_saveButton.centerYAnchor],
    ]];
    [topBar addArrangedSubview:_saveButton];
  }
  topBar.translatesAutoresizingMaskIntoConstraints = NO;
  [_controls addSubview:topBar];

  // Centre: back 5 s, play / pause, forward 15 s.
  UIButton *backButton = [self seekButton:[self skipSymbol:@"gobackward" seconds:self.skipBackSeconds]
                                    label:[self label:@"seekBack" seconds:self.skipBackSeconds]
                                   action:@selector(backTapped)];
  UIButton *forwardButton = [self seekButton:[self skipSymbol:@"goforward" seconds:self.skipForwardSeconds]
                                       label:[self label:@"seekForward" seconds:self.skipForwardSeconds]
                                      action:@selector(forwardTapped)];
  // A hidden skip button keeps its place, so play stays centred.
  for (UIButton *button in @[ backButton, forwardButton ]) {
    BOOL isOff = (button == backButton ? self.skipBackSeconds : self.skipForwardSeconds) <= 0;
    button.alpha = isOff ? 0 : 1;
    button.userInteractionEnabled = !isOff;
    button.accessibilityElementsHidden = isOff;
  }
  _playButton = [UIButton buttonWithType:UIButtonTypeSystem];
  _playButton.tintColor = [UIColor colorWithWhite:0.07 alpha:1];
  _playButton.backgroundColor = UIColor.whiteColor;
  _playButton.layer.cornerRadius = 32;
  [_playButton addTarget:self action:@selector(playTapped) forControlEvents:UIControlEventTouchUpInside];
  _playButton.translatesAutoresizingMaskIntoConstraints = NO;
  _bufferingSpinner = [[UIActivityIndicatorView alloc] initWithActivityIndicatorStyle:UIActivityIndicatorViewStyleLarge];
  _bufferingSpinner.color = UIColor.whiteColor;
  _bufferingSpinner.translatesAutoresizingMaskIntoConstraints = NO;
  _centerRow = [[UIStackView alloc] initWithArrangedSubviews:@[ backButton, _playButton, forwardButton ]];
  _centerRow.alignment = UIStackViewAlignmentCenter;
  _centerRow.spacing = 36;
  _centerRow.translatesAutoresizingMaskIntoConstraints = NO;
  [_controls addSubview:_centerRow];
  [_controls addSubview:_bufferingSpinner];

  // Bottom: times, seek bar, speed / sound / full screen.
  _positionLabel = [self labelWithSize:12 weight:UIFontWeightRegular color:UIColor.whiteColor];
  _remainingLabel = [self labelWithSize:12 weight:UIFontWeightRegular color:UIColor.whiteColor];
  _remainingLabel.textAlignment = NSTextAlignmentRight;
  _slider = [UISlider new];
  _slider.minimumTrackTintColor = _accentColor;
  _slider.maximumTrackTintColor = [UIColor colorWithWhite:1 alpha:0.3];
  [_slider setThumbImage:[self thumbImage] forState:UIControlStateNormal];
  [_slider addTarget:self action:@selector(scrubStarted) forControlEvents:UIControlEventTouchDown];
  [_slider addTarget:self action:@selector(scrubChanged) forControlEvents:UIControlEventValueChanged];
  [_slider addTarget:self
                action:@selector(scrubEnded)
      forControlEvents:UIControlEventTouchUpInside | UIControlEventTouchUpOutside | UIControlEventTouchCancel];
  _slider.translatesAutoresizingMaskIntoConstraints = NO;

  _speedButton = [UIButton buttonWithType:UIButtonTypeSystem];
  _speedButton.tintColor = UIColor.whiteColor;
  _speedButton.titleLabel.font = [UIFont monospacedDigitSystemFontOfSize:13 weight:UIFontWeightMedium];
  _speedButton.layer.borderWidth = 1;
  _speedButton.layer.borderColor = [UIColor colorWithWhite:1 alpha:0.6].CGColor;
  _speedButton.layer.cornerRadius = 15;
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
  // UIButtonConfiguration would do the same from iOS 15, but draws its own background.
  _speedButton.contentEdgeInsets = UIEdgeInsetsMake(5, 10, 5, 10);
#pragma clang diagnostic pop
  [_speedButton addTarget:self action:@selector(speedTapped) forControlEvents:UIControlEventTouchUpInside];
  _soundButton = [self iconButton:@"speaker.wave.2" pointSize:18 action:@selector(soundTapped)];
  _fullScreenButton = [self iconButton:@"arrow.up.left.and.arrow.down.right" pointSize:17 action:@selector(fullScreenTapped)];
  _speedButton.hidden = !self.allowSpeed;
  _fullScreenButton.hidden = !self.allowFullScreen;
  UIView *spacer = [UIView new];
  UIStackView *actions = [[UIStackView alloc] initWithArrangedSubviews:@[ _speedButton, spacer, _soundButton, _fullScreenButton ]];
  actions.alignment = UIStackViewAlignmentCenter;
  actions.translatesAutoresizingMaskIntoConstraints = NO;

  for (UIView *subview in @[ _positionLabel, _remainingLabel, _slider, actions ]) {
    [_controls addSubview:subview];
  }

  _messageLabel = [self labelWithSize:14 weight:UIFontWeightRegular color:UIColor.whiteColor];
  _messageLabel.backgroundColor = [UIColor colorWithWhite:0 alpha:0.75];
  _messageLabel.textAlignment = NSTextAlignmentCenter;
  _messageLabel.layer.cornerRadius = 8;
  _messageLabel.clipsToBounds = YES;
  _messageLabel.alpha = 0;
  [view addSubview:_messageLabel];

  [NSLayoutConstraint activateConstraints:@[
    [_playerView.topAnchor constraintEqualToAnchor:view.topAnchor],
    [_playerView.bottomAnchor constraintEqualToAnchor:view.bottomAnchor],
    [_playerView.leadingAnchor constraintEqualToAnchor:view.leadingAnchor],
    [_playerView.trailingAnchor constraintEqualToAnchor:view.trailingAnchor],
    [_controls.topAnchor constraintEqualToAnchor:view.topAnchor],
    [_controls.bottomAnchor constraintEqualToAnchor:view.bottomAnchor],
    [_controls.leadingAnchor constraintEqualToAnchor:view.leadingAnchor],
    [_controls.trailingAnchor constraintEqualToAnchor:view.trailingAnchor],
    [_errorLabel.centerYAnchor constraintEqualToAnchor:view.centerYAnchor],
    [_errorLabel.leadingAnchor constraintEqualToAnchor:safe.leadingAnchor constant:24],
    [_errorLabel.trailingAnchor constraintEqualToAnchor:safe.trailingAnchor constant:-24],

    [topScrim.topAnchor constraintEqualToAnchor:view.topAnchor],
    [topScrim.leadingAnchor constraintEqualToAnchor:view.leadingAnchor],
    [topScrim.trailingAnchor constraintEqualToAnchor:view.trailingAnchor],
    [topScrim.bottomAnchor constraintEqualToAnchor:topBar.bottomAnchor constant:24],
    [topBar.topAnchor constraintEqualToAnchor:safe.topAnchor constant:4],
    [topBar.leadingAnchor constraintEqualToAnchor:safe.leadingAnchor constant:4],
    [topBar.trailingAnchor constraintEqualToAnchor:safe.trailingAnchor constant:-8],

    [_centerRow.centerXAnchor constraintEqualToAnchor:view.centerXAnchor],
    [_centerRow.centerYAnchor constraintEqualToAnchor:view.centerYAnchor],
    [_playButton.widthAnchor constraintEqualToConstant:64],
    [_playButton.heightAnchor constraintEqualToConstant:64],
    [_bufferingSpinner.centerXAnchor constraintEqualToAnchor:_playButton.centerXAnchor],
    [_bufferingSpinner.centerYAnchor constraintEqualToAnchor:_playButton.centerYAnchor],

    [bottomScrim.bottomAnchor constraintEqualToAnchor:view.bottomAnchor],
    [bottomScrim.leadingAnchor constraintEqualToAnchor:view.leadingAnchor],
    [bottomScrim.trailingAnchor constraintEqualToAnchor:view.trailingAnchor],
    [bottomScrim.topAnchor constraintEqualToAnchor:_positionLabel.topAnchor constant:-32],
    [actions.bottomAnchor constraintEqualToAnchor:safe.bottomAnchor constant:-4],
    [actions.leadingAnchor constraintEqualToAnchor:safe.leadingAnchor constant:16],
    [actions.trailingAnchor constraintEqualToAnchor:safe.trailingAnchor constant:-8],
    [_slider.bottomAnchor constraintEqualToAnchor:actions.topAnchor constant:-4],
    [_slider.leadingAnchor constraintEqualToAnchor:safe.leadingAnchor constant:16],
    [_slider.trailingAnchor constraintEqualToAnchor:safe.trailingAnchor constant:-16],
    [_positionLabel.bottomAnchor constraintEqualToAnchor:_slider.topAnchor constant:-2],
    [_positionLabel.leadingAnchor constraintEqualToAnchor:_slider.leadingAnchor],
    [_remainingLabel.firstBaselineAnchor constraintEqualToAnchor:_positionLabel.firstBaselineAnchor],
    [_remainingLabel.trailingAnchor constraintEqualToAnchor:_slider.trailingAnchor],

    [_messageLabel.centerXAnchor constraintEqualToAnchor:view.centerXAnchor],
    [_messageLabel.bottomAnchor constraintEqualToAnchor:_slider.topAnchor constant:-40],
    [_messageLabel.widthAnchor constraintLessThanOrEqualToAnchor:safe.widthAnchor constant:-48],
    [_messageLabel.heightAnchor constraintGreaterThanOrEqualToConstant:36],
  ]];

  // A tap on the video shows or hides the controls; taps on buttons stay with the buttons.
  UITapGestureRecognizer *tap = [[UITapGestureRecognizer alloc] initWithTarget:self action:@selector(viewTapped)];
  tap.delegate = self;
  [view addGestureRecognizer:tap];
}

- (UIImage *)thumbImage
{
  UIGraphicsImageRenderer *renderer =
      [[UIGraphicsImageRenderer alloc] initWithSize:CGSizeMake(DocumentKitThumbSize, DocumentKitThumbSize)];
  return [renderer imageWithActions:^(UIGraphicsImageRendererContext *context) {
    [UIColor.whiteColor setFill];
    [[UIBezierPath bezierPathWithOvalInRect:CGRectMake(0, 0, DocumentKitThumbSize, DocumentKitThumbSize)] fill];
  }];
}

- (BOOL)gestureRecognizer:(UIGestureRecognizer *)gestureRecognizer shouldReceiveTouch:(UITouch *)touch
{
  return ![touch.view isKindOfClass:UIControl.class];
}

#pragma mark - Player

- (void)observePlayer
{
  _isObserving = YES;
  [_player addObserver:self forKeyPath:@"timeControlStatus" options:NSKeyValueObservingOptionNew context:DocumentKitTimeControlContext];
  [_player.currentItem addObserver:self forKeyPath:@"status" options:NSKeyValueObservingOptionNew context:DocumentKitItemStatusContext];
  [NSNotificationCenter.defaultCenter addObserver:self
                                         selector:@selector(playbackEnded:)
                                             name:AVPlayerItemDidPlayToEndTimeNotification
                                           object:_player.currentItem];
  __weak __typeof(self) weakSelf = self;
  _timeObserver = [_player addPeriodicTimeObserverForInterval:CMTimeMakeWithSeconds(0.25, NSEC_PER_SEC)
                                                        queue:dispatch_get_main_queue()
                                                   usingBlock:^(CMTime time) {
                                                     [weakSelf updateProgress];
                                                   }];
}

- (void)observeValueForKeyPath:(NSString *)keyPath
                      ofObject:(id)object
                        change:(NSDictionary<NSKeyValueChangeKey, id> *)change
                       context:(void *)context
{
  if (context != DocumentKitTimeControlContext && context != DocumentKitItemStatusContext) {
    [super observeValueForKeyPath:keyPath ofObject:object change:change context:context];
    return;
  }
  // KVO can arrive on any thread.
  dispatch_async(dispatch_get_main_queue(), ^{
    if (context == DocumentKitItemStatusContext) {
      [self itemStatusChanged];
    } else {
      [self updatePlayButton];
    }
  });
}

- (void)itemStatusChanged
{
  AVPlayerItem *item = _player.currentItem;
  if (item.status == AVPlayerItemStatusFailed) {
    [self handlePlaybackFailure];
  } else if (item.status == AVPlayerItemStatusReadyToPlay) {
    [self updateSubtitle];
    [self updateProgress];
  }
}

/**
 * A 401/403 closes the player as "unauthorized" so JS can refresh the session;
 * anything else shows the playback error. AVPlayer keeps the status only in its
 * error log (and not for every source), so a remote URL is asked again for one
 * byte with the same headers to read it.
 */
- (void)handlePlaybackFailure
{
  NSInteger loggedStatus = _player.currentItem.errorLog.events.lastObject.errorStatusCode;
  if (loggedStatus == 401 || loggedStatus == 403) {
    [self closeAsUnauthorized:loggedStatus];
    return;
  }
  NSString *scheme = _mediaURL.scheme.lowercaseString;
  if (![scheme isEqualToString:@"http"] && ![scheme isEqualToString:@"https"]) {
    [self showPlaybackError];
    return;
  }
  NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:_mediaURL];
  // Only these headers, like the player: no cookies from the shared store.
  request.HTTPShouldHandleCookies = NO;
  request.timeoutInterval = 15;
  [_headers enumerateKeysAndObjectsUsingBlock:^(NSString *name, NSString *value, BOOL *stop) {
    [request setValue:value forHTTPHeaderField:name];
  }];
  [request setValue:@"bytes=0-0" forHTTPHeaderField:@"Range"];
  __weak __typeof(self) weakSelf = self;
  _statusCheckTask = [NSURLSession.sharedSession
      dataTaskWithRequest:request
        completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
          NSInteger status =
              [response isKindOfClass:NSHTTPURLResponse.class] ? ((NSHTTPURLResponse *)response).statusCode : 0;
          dispatch_async(dispatch_get_main_queue(), ^{
            if (status == 401 || status == 403) {
              [weakSelf closeAsUnauthorized:status];
            } else {
              [weakSelf showPlaybackError];
            }
          });
        }];
  [_statusCheckTask resume];
}

- (void)closeAsUnauthorized:(NSInteger)httpStatus
{
  _finishOutcome = @"unauthorized";
  _finishHttpStatus = httpStatus;
  [self dismissViewControllerAnimated:YES completion:nil];
}

- (void)showPlaybackError
{
  _errorLabel.hidden = NO;
  _centerRow.hidden = YES;
  [self setControlsVisible:YES];
}

- (void)playbackEnded:(NSNotification *)notification
{
  _hasEnded = YES;
  [self updatePlayButton];
  [self setControlsVisible:YES];
}

- (BOOL)isPlaying
{
  return _player.timeControlStatus != AVPlayerTimeControlStatusPaused;
}

- (void)playAtCurrentSpeed
{
  [_player playImmediatelyAtRate:_speeds[_speedIndex].floatValue];
}

- (double)durationSeconds
{
  CMTime duration = _player.currentItem.duration;
  return CMTIME_IS_NUMERIC(duration) ? CMTimeGetSeconds(duration) : 0;
}

- (void)seekToSeconds:(double)seconds
{
  double duration = [self durationSeconds];
  double target = MAX(0, duration > 0 ? MIN(seconds, duration) : seconds);
  _hasEnded = NO;
  [_player seekToTime:CMTimeMakeWithSeconds(target, NSEC_PER_SEC)
      toleranceBefore:kCMTimeZero
       toleranceAfter:kCMTimeZero];
  [self updatePlayButton];
}

#pragma mark - Actions

- (void)closeTapped
{
  [self dismissViewControllerAnimated:YES completion:nil];
}

- (void)playTapped
{
  if (_hasEnded) {
    [self seekToSeconds:0];
    [self playAtCurrentSpeed];
  } else if ([self isPlaying]) {
    [_player pause];
  } else {
    [self playAtCurrentSpeed];
  }
  [self scheduleHide];
}

- (void)backTapped
{
  [self seekToSeconds:CMTimeGetSeconds(_player.currentTime) - self.skipBackSeconds];
  [self scheduleHide];
}

- (void)forwardTapped
{
  [self seekToSeconds:CMTimeGetSeconds(_player.currentTime) + self.skipForwardSeconds];
  [self scheduleHide];
}

- (void)speedTapped
{
  _speedIndex = (_speedIndex + 1) % _speeds.count;
  if ([self isPlaying]) {
    _player.rate = _speeds[_speedIndex].floatValue;
  }
  [self updateSpeedButton];
  [self scheduleHide];
}

- (void)soundTapped
{
  _player.muted = !_player.muted;
  [self updateSoundButton];
  [self scheduleHide];
}

- (void)scrubStarted
{
  _isScrubbing = YES;
  [NSObject cancelPreviousPerformRequestsWithTarget:self selector:@selector(hideControls) object:nil];
}

- (void)scrubChanged
{
  [self showTimesAt:_slider.value duration:[self durationSeconds]];
}

- (void)scrubEnded
{
  _isScrubbing = NO;
  [self seekToSeconds:_slider.value];
  [self scheduleHide];
}

- (void)viewTapped
{
  [self setControlsVisible:!_areControlsVisible];
}

#pragma mark - Full screen

/**
 * Hides the status bar. A landscape video turns the screen to landscape when
 * the app allows it; otherwise (or for a portrait video) the video fills the screen.
 */
- (void)fullScreenTapped
{
  _isFullScreen = !_isFullScreen;
  CGSize videoSize = _player.currentItem.presentationSize;
  UIInterfaceOrientationMask appOrientations =
      [UIApplication.sharedApplication supportedInterfaceOrientationsForWindow:self.view.window];
  BOOL canRotate = videoSize.width > videoSize.height && (appOrientations & UIInterfaceOrientationMaskLandscape) != 0;
  BOOL wasRotated = _isRotatedForFullScreen;
  _isRotatedForFullScreen = _isFullScreen && canRotate;
  _playerView.playerLayer.videoGravity =
      _isFullScreen && !canRotate ? AVLayerVideoGravityResizeAspectFill : AVLayerVideoGravityResizeAspect;
  [self setNeedsStatusBarAppearanceUpdate];
  [self setNeedsUpdateOfHomeIndicatorAutoHidden];
  if (_isRotatedForFullScreen) {
    [self requestOrientations:UIInterfaceOrientationMaskLandscape legacyOrientation:UIInterfaceOrientationLandscapeRight];
  } else if (wasRotated) {
    [self requestOrientations:UIInterfaceOrientationMaskPortrait legacyOrientation:UIInterfaceOrientationPortrait];
  }
  [self updateFullScreenButton];
  [self scheduleHide];
}

- (void)requestOrientations:(UIInterfaceOrientationMask)mask legacyOrientation:(UIInterfaceOrientation)orientation
{
  if (@available(iOS 16.0, *)) {
    [self setNeedsUpdateOfSupportedInterfaceOrientations];
    UIWindowSceneGeometryPreferencesIOS *preferences =
        [[UIWindowSceneGeometryPreferencesIOS alloc] initWithInterfaceOrientations:mask];
    [self.view.window.windowScene requestGeometryUpdateWithPreferences:preferences
                                                          errorHandler:^(NSError *error){
                                                              // Not allowed here (e.g. iPad multitasking): the video still fills the screen.
                                                          }];
  } else {
    [UIDevice.currentDevice setValue:@(orientation) forKey:@"orientation"];
    [UIViewController attemptRotationToDeviceOrientation];
  }
}

#pragma mark - Save (Download)

- (void)saveTapped
{
  if (_isSaving) {
    return;
  }
  [self setSaving:YES];
  if (_mediaURL.isFileURL) {
    NSError *error = nil;
    NSURL *exportURL = [self exportCopyOf:_mediaURL move:NO error:&error];
    [self presentSaveSheetFor:exportURL];
    return;
  }
  // A streamed video: fetch it first, with the same headers the player used.
  NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:_mediaURL];
  [_headers enumerateKeysAndObjectsUsingBlock:^(NSString *name, NSString *value, BOOL *stop) {
    [request setValue:value forHTTPHeaderField:name];
  }];
  __weak __typeof(self) weakSelf = self;
  _saveTask = [NSURLSession.sharedSession
      downloadTaskWithRequest:request
            completionHandler:^(NSURL *location, NSURLResponse *response, NSError *error) {
              NSInteger status =
                  [response isKindOfClass:NSHTTPURLResponse.class] ? ((NSHTTPURLResponse *)response).statusCode : 200;
              // `location` is deleted when this block returns, so it is moved now.
              NSURL *exportURL = nil;
              __typeof(self) strongSelf = weakSelf;
              if (strongSelf != nil && location != nil && error == nil && status >= 200 && status < 300) {
                exportURL = [strongSelf exportCopyOf:location move:YES error:nil];
              }
              dispatch_async(dispatch_get_main_queue(), ^{
                [weakSelf presentSaveSheetFor:exportURL];
              });
            }];
  [_saveTask resume];
}

- (void)presentSaveSheetFor:(nullable NSURL *)exportURL
{
  _saveTask = nil;
  if (exportURL == nil || self.presentingViewController == nil) {
    [self removeExportDirectory];
    [self setSaving:NO];
    if (exportURL == nil) {
      [self showMessage:[self label:@"saveFailed"]];
    }
    return;
  }
  // Save to Files: the user chooses the folder; iOS copies the file there.
  UIDocumentPickerViewController *picker = [[UIDocumentPickerViewController alloc] initForExportingURLs:@[ exportURL ]
                                                                                                 asCopy:YES];
  picker.delegate = self;
  [self presentViewController:picker animated:YES completion:nil];
}

- (void)documentPicker:(UIDocumentPickerViewController *)controller didPickDocumentsAtURLs:(NSArray<NSURL *> *)urls
{
  [self removeExportDirectory];
  [self setSaving:NO];
}

- (void)documentPickerWasCancelled:(UIDocumentPickerViewController *)controller
{
  [self removeExportDirectory];
  [self setSaving:NO];
}

/// A copy in its own temporary folder, named for the user (Files saves under the file's own name).
- (nullable NSURL *)exportCopyOf:(NSURL *)fileURL move:(BOOL)move error:(NSError **)error
{
  NSString *name = [[_title componentsSeparatedByCharactersInSet:[NSCharacterSet characterSetWithCharactersInString:@"/\\:"]]
      componentsJoinedByString:@"_"];
  if (name.length == 0) {
    name = _mediaURL.lastPathComponent.length > 0 ? _mediaURL.lastPathComponent : @"Video";
  }
  if (name.pathExtension.length == 0) {
    NSString *extension = _mimeType.length > 0 ? [UTType typeWithMIMEType:_mimeType].preferredFilenameExtension : nil;
    extension = extension ?: _mediaURL.pathExtension;
    if (extension.length > 0) {
      name = [name stringByAppendingPathExtension:extension];
    }
  }
  NSURL *directory = [[NSURL fileURLWithPath:NSTemporaryDirectory()]
      URLByAppendingPathComponent:[@"document-kit-save" stringByAppendingPathComponent:NSUUID.UUID.UUIDString]
                      isDirectory:YES];
  if (![NSFileManager.defaultManager createDirectoryAtURL:directory withIntermediateDirectories:YES attributes:nil error:error]) {
    return nil;
  }
  NSURL *exportURL = [directory URLByAppendingPathComponent:name];
  BOOL isCopied = move ? [NSFileManager.defaultManager moveItemAtURL:fileURL toURL:exportURL error:error]
                       : [NSFileManager.defaultManager copyItemAtURL:fileURL toURL:exportURL error:error];
  if (!isCopied) {
    [NSFileManager.defaultManager removeItemAtURL:directory error:nil];
    return nil;
  }
  @synchronized(self) {
    _exportDirectory = directory;
  }
  return exportURL;
}

- (void)removeExportDirectory
{
  NSURL *directory = nil;
  @synchronized(self) {
    directory = _exportDirectory;
    _exportDirectory = nil;
  }
  if (directory != nil) {
    [NSFileManager.defaultManager removeItemAtURL:directory error:nil];
  }
}

- (void)setSaving:(BOOL)isSaving
{
  _isSaving = isSaving;
  _saveButton.imageView.alpha = isSaving ? 0 : 1;
  if (isSaving) {
    [_saveSpinner startAnimating];
  } else {
    [_saveSpinner stopAnimating];
  }
}

- (void)showMessage:(NSString *)message
{
  if (message.length == 0) {
    return;
  }
  _messageLabel.text = [NSString stringWithFormat:@"  %@  ", message];
  [UIView animateWithDuration:DocumentKitFadeDuration
      animations:^{
        self->_messageLabel.alpha = 1;
      }
      completion:^(BOOL finished) {
        [UIView animateWithDuration:DocumentKitFadeDuration
                              delay:DocumentKitMessageDuration
                            options:0
                         animations:^{
                           self->_messageLabel.alpha = 0;
                         }
                         completion:nil];
      }];
}

#pragma mark - Controls visibility

- (void)setControlsVisible:(BOOL)visible
{
  [NSObject cancelPreviousPerformRequestsWithTarget:self selector:@selector(hideControls) object:nil];
  if (!visible && (![self isPlaying] || _isScrubbing || !_errorLabel.hidden)) {
    // Only hide over a playing video.
    return;
  }
  _areControlsVisible = visible;
  [UIView animateWithDuration:DocumentKitFadeDuration
                   animations:^{
                     self->_controls.alpha = visible ? 1 : 0;
                   }];
  _controls.userInteractionEnabled = visible;
  if (visible) {
    [self scheduleHide];
  }
}

- (void)hideControls
{
  [self setControlsVisible:NO];
}

- (void)scheduleHide
{
  [NSObject cancelPreviousPerformRequestsWithTarget:self selector:@selector(hideControls) object:nil];
  if ([self isPlaying]) {
    [self performSelector:@selector(hideControls) withObject:nil afterDelay:DocumentKitHideControlsDelay];
  }
}

#pragma mark - State to views

- (void)updatePlayButton
{
  BOOL isBuffering = _player.timeControlStatus == AVPlayerTimeControlStatusWaitingToPlayAtSpecifiedRate;
  _playButton.alpha = isBuffering ? 0 : 1;
  if (isBuffering) {
    [_bufferingSpinner startAnimating];
  } else {
    [_bufferingSpinner stopAnimating];
  }
  BOOL isPlaying = [self isPlaying];
  [self setSymbol:isPlaying ? @"pause.fill" : @"play.fill" pointSize:26 onButton:_playButton];
  _playButton.accessibilityLabel = [self label:isPlaying ? @"pause" : @"play"];
  if (isPlaying) {
    _hasEnded = NO;
    [self scheduleHide];
  } else {
    [self setControlsVisible:YES];
  }
}

- (void)updateProgress
{
  double duration = [self durationSeconds];
  _slider.maximumValue = (float)MAX(duration, 0);
  if (!_isScrubbing) {
    double position = CMTimeGetSeconds(_player.currentTime);
    _slider.value = (float)(isfinite(position) ? position : 0);
    [self showTimesAt:_slider.value duration:duration];
  }
}

- (void)showTimesAt:(double)position duration:(double)duration
{
  _positionLabel.text = DocumentKitFormatTime(position);
  _remainingLabel.text = duration > 0 ? [@"-" stringByAppendingString:DocumentKitFormatTime(duration - position)] : @"";
}

/// "00:18 · 4.2 MB": the length once known, and the size for local files.
- (void)updateSubtitle
{
  NSMutableArray<NSString *> *parts = [NSMutableArray array];
  double duration = [self durationSeconds];
  if (duration > 0) {
    [parts addObject:DocumentKitFormatTime(duration)];
  }
  if (_sizeLabel != nil) {
    [parts addObject:_sizeLabel];
  }
  _subtitleLabel.text = [parts componentsJoinedByString:@" · "];
  _subtitleLabel.hidden = parts.count == 0;
}

- (void)updateSoundButton
{
  [self setSymbol:_player.muted ? @"speaker.slash" : @"speaker.wave.2" pointSize:18 onButton:_soundButton];
  // Names the action the button takes.
  _soundButton.accessibilityLabel = [self label:_player.muted ? @"unmute" : @"mute"];
}

- (void)updateFullScreenButton
{
  [self setSymbol:_isFullScreen ? @"arrow.down.right.and.arrow.up.left" : @"arrow.up.left.and.arrow.down.right"
        pointSize:17
         onButton:_fullScreenButton];
  _fullScreenButton.accessibilityLabel = [self label:_isFullScreen ? @"exitFullScreen" : @"fullScreen"];
}

- (void)updateSpeedButton
{
  NSString *speed = DocumentKitFormatSpeed(_speeds[_speedIndex].floatValue);
  [_speedButton setTitle:speed forState:UIControlStateNormal];
  _speedButton.accessibilityLabel = [NSString stringWithFormat:@"%@, %@", [self label:@"playbackSpeed"], speed];
}

/// Size of a local file; nil for streams.
- (nullable NSString *)localSizeLabel
{
  if (!_mediaURL.isFileURL) {
    return nil;
  }
  NSNumber *size = [NSFileManager.defaultManager attributesOfItemAtPath:_mediaURL.path error:nil][NSFileSize];
  return size.longLongValue > 0 ? DocumentKitFormatSize(size.longLongValue) : nil;
}

@end
