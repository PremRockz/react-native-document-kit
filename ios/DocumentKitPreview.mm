#import "DocumentKitPreview.h"
#import "DocumentKitPlayerViewController.h"
#import "DocumentKitPresenter.h"

#import <AVFoundation/AVFoundation.h>
#import <AVKit/AVKit.h>
#import <QuickLook/QuickLook.h>
#import <React/RCTUtils.h>
#import <UIKit/UIKit.h>

static NSString *const DocumentKitOutcomeClosed = @"closed";
static NSString *const DocumentKitOutcomeUnsupported = @"unsupported";
static NSString *const DocumentKitErrorBusy = @"E_BUSY";
static NSString *const DocumentKitErrorNoPresenter = @"E_NO_ACTIVITY";
static NSString *const DocumentKitErrorViewer = @"E_VIEWER";

/// One QuickLook item with a readable title instead of the cached file name.
@interface DocumentKitPreviewItem : NSObject <QLPreviewItem>
@property (nonatomic, strong) NSURL *previewItemURL;
@property (nonatomic, copy) NSString *previewItemTitle;
@end

@implementation DocumentKitPreviewItem
@end

/// processColor's ARGB as a colour; nil for 0, so the player keeps its default.
static UIColor *_Nullable DocumentKitColorFromARGB(double value)
{
  uint32_t argb = (uint32_t)(int64_t)value;
  if (argb == 0) {
    return nil;
  }
  return [UIColor colorWithRed:((argb >> 16) & 0xFF) / 255.0
                         green:((argb >> 8) & 0xFF) / 255.0
                          blue:(argb & 0xFF) / 255.0
                         alpha:((argb >> 24) & 0xFF) / 255.0];
}

@interface DocumentKitPreview () <QLPreviewControllerDataSource, QLPreviewControllerDelegate>
@end

@implementation DocumentKitPreview {
  DocumentKitPreviewItem *_previewItem;
  // Set while a preview is on screen; cleared before the promise settles so it settles once.
  RCTPromiseResolveBlock _pendingResolve;
}

RCT_EXPORT_MODULE()

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

#pragma mark - Spec

- (void)presentFile:(NSString *)fileUri
              title:(NSString *)title
           mimeType:(NSString *)mimeType
             labels:(JS::NativeDocumentKitPreview::NativePreviewLabels &)labels
               save:(JS::NativeDocumentKitPreview::NativePreviewSave &)save
            resolve:(RCTPromiseResolveBlock)resolve
             reject:(RCTPromiseRejectBlock)reject
{
  // `save` is Android-only: QuickLook's own share button already offers Save to Files.
  NSURL *fileURL = [NSURL URLWithString:fileUri];
  dispatch_async(dispatch_get_main_queue(), ^{
    if (fileURL == nil || !fileURL.isFileURL) {
      reject(DocumentKitErrorViewer, @"Only local files can be previewed", nil);
      return;
    }
    DocumentKitPreviewItem *item = [DocumentKitPreviewItem new];
    item.previewItemURL = fileURL;
    item.previewItemTitle = title.length > 0 ? title : fileURL.lastPathComponent;
    if (![QLPreviewController canPreviewItem:item]) {
      resolve(DocumentKitOutcomeUnsupported);
      return;
    }

    if (self->_pendingResolve != nil) {
      // Checked before _previewItem changes: the open preview reads it when it reloads.
      reject(DocumentKitErrorBusy, @"A preview is already open", nil);
      return;
    }
    QLPreviewController *previewController = [QLPreviewController new];
    previewController.dataSource = self;
    previewController.delegate = self;
    previewController.modalPresentationStyle = UIModalPresentationFullScreen;
    self->_previewItem = item;
    [self present:previewController resolve:resolve reject:reject];
  });
}

- (void)playMedia:(NSString *)url
          headers:(NSDictionary *)headers
            title:(NSString *)title
           labels:(JS::NativeDocumentKitPreview::NativePreviewLabels &)labels
          options:(JS::NativeDocumentKitPreview::NativePlayerOptions &)options
          resolve:(RCTPromiseResolveBlock)resolve
           reject:(RCTPromiseRejectBlock)reject
{
  NSURL *mediaURL = [NSURL URLWithString:url];
  // Read now: the codegen structs only wrap JS values for the length of this call.
  NSDictionary<NSString *, NSString *> *playerLabels = @{
    @"close" : labels.close() ?: @"",
    @"playbackError" : labels.playbackError() ?: @"",
    @"save" : labels.save() ?: @"",
    @"saveFailed" : labels.saveFailed() ?: @"",
    @"mute" : labels.mute() ?: @"",
    @"unmute" : labels.unmute() ?: @"",
    @"play" : labels.play() ?: @"",
    @"pause" : labels.pause() ?: @"",
    @"seekBack" : labels.seekBack() ?: @"",
    @"seekForward" : labels.seekForward() ?: @"",
    @"playbackSpeed" : labels.playbackSpeed() ?: @"",
    @"fullScreen" : labels.fullScreen() ?: @"",
    @"exitFullScreen" : labels.exitFullScreen() ?: @"",
  };
  NSMutableDictionary<NSString *, NSString *> *stringHeaders = [NSMutableDictionary dictionary];
  [headers enumerateKeysAndObjectsUsingBlock:^(id name, id value, BOOL *stop) {
    if ([name isKindOfClass:NSString.class] && [value isKindOfClass:NSString.class]) {
      stringHeaders[name] = value;
    }
  }];
  BOOL isMuted = options.muted();
  UIColor *accentColor = DocumentKitColorFromARGB(options.accentColor());
  NSString *mimeType = options.mimeType() ?: @"";
  // iOS saves through the Save to Files sheet, so only whether to offer it matters here.
  BOOL canSave = options.save().has_value();
  double startPositionMs = options.startPositionMs();
  BOOL autoPlay = options.autoPlay();
  NSInteger skipBackSeconds = (NSInteger)options.skipBackSeconds();
  NSInteger skipForwardSeconds = (NSInteger)options.skipForwardSeconds();
  BOOL allowSpeed = options.allowSpeed();
  BOOL allowFullScreen = options.allowFullScreen();
  dispatch_async(dispatch_get_main_queue(), ^{
    if (mediaURL == nil) {
      reject(DocumentKitErrorViewer, @"Invalid media URL", nil);
      return;
    }
    // Streams with range requests; nothing is downloaded first.
    NSArray<NSHTTPCookie *> *cookies = [self cookiesFromHeaders:headers forURL:mediaURL];
    AVURLAsset *asset = [AVURLAsset URLAssetWithURL:mediaURL
                                            options:cookies.count > 0 ? @{AVURLAssetHTTPCookiesKey : cookies} : nil];

    if (self->_pendingResolve != nil) {
      reject(DocumentKitErrorBusy, @"A preview is already open", nil);
      return;
    }
    // Plays with sound even when the ring/silent switch is on silent, like other video apps.
    // The app's own audio setup comes back when the player closes.
    AVAudioSession *audioSession = AVAudioSession.sharedInstance;
    AVAudioSessionCategory previousCategory = audioSession.category;
    AVAudioSessionMode previousMode = audioSession.mode;
    AVAudioSessionCategoryOptions previousOptions = audioSession.categoryOptions;
    [audioSession setCategory:AVAudioSessionCategoryPlayback error:nil];

    DocumentKitPlayerViewController *playerController =
        [[DocumentKitPlayerViewController alloc] initWithAsset:asset
                                                      mediaURL:mediaURL
                                                       headers:stringHeaders
                                                         title:title
                                                      mimeType:mimeType
                                                        labels:playerLabels
                                                   accentColor:accentColor
                                                         muted:isMuted
                                                       canSave:canSave];
    playerController.startPositionMs = startPositionMs;
    playerController.autoPlay = autoPlay;
    playerController.skipBackSeconds = skipBackSeconds;
    playerController.skipForwardSeconds = skipForwardSeconds;
    playerController.allowSpeed = allowSpeed;
    playerController.allowFullScreen = allowFullScreen;
    __weak DocumentKitPreview *weakSelf = self;
    playerController.onFinish = ^(NSString *outcome, double positionMs, NSInteger httpStatus) {
      [audioSession setCategory:previousCategory mode:previousMode options:previousOptions error:nil];
      // NativePlayerOutcome.
      [weakSelf resolvePending:@{@"outcome" : outcome, @"positionMs" : @(positionMs), @"httpStatus" : @(httpStatus)}];
    };
    // The player starts itself once on screen.
    [self present:playerController resolve:resolve reject:reject];
  });
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeDocumentKitPreviewSpecJSI>(params);
}

#pragma mark - QuickLook

- (NSInteger)numberOfPreviewItemsInPreviewController:(QLPreviewController *)controller
{
  return _previewItem != nil ? 1 : 0;
}

- (id<QLPreviewItem>)previewController:(QLPreviewController *)controller previewItemAtIndex:(NSInteger)index
{
  return _previewItem;
}

- (void)previewControllerDidDismiss:(QLPreviewController *)controller
{
  _previewItem = nil;
  [self resolvePending:DocumentKitOutcomeClosed];
}

#pragma mark - Helpers

- (void)present:(UIViewController *)viewController
        resolve:(RCTPromiseResolveBlock)resolve
         reject:(RCTPromiseRejectBlock)reject
{
  if (_pendingResolve != nil) {
    reject(DocumentKitErrorBusy, @"A preview is already open", nil);
    return;
  }
  _pendingResolve = resolve;
  [DocumentKitPresenter present:viewController
                      onFailure:^{
                        // Cleared, or every later preview would fail with E_BUSY.
                        self->_pendingResolve = nil;
                        reject(DocumentKitErrorNoPresenter, @"No view controller to present the preview from", nil);
                      }];
}

/// An outcome string (QuickLook) or a NativePlayerOutcome dictionary (playMedia).
- (void)resolvePending:(id)outcome
{
  RCTPromiseResolveBlock resolve = _pendingResolve;
  _pendingResolve = nil;
  if (resolve != nil) {
    resolve(outcome);
  }
}

/// AVPlayer takes cookies, not arbitrary headers, so a "Cookie" header is split into cookies for the URL's host.
- (NSArray<NSHTTPCookie *> *)cookiesFromHeaders:(NSDictionary *)headers forURL:(NSURL *)url
{
  if (url.host.length == 0) {
    return @[];
  }
  NSString *cookieHeader = nil;
  for (id name in headers) {
    if ([name isKindOfClass:NSString.class] && [name caseInsensitiveCompare:@"Cookie"] == NSOrderedSame) {
      id value = headers[name];
      cookieHeader = [value isKindOfClass:NSString.class] ? value : nil;
    }
  }

  NSMutableArray<NSHTTPCookie *> *cookies = [NSMutableArray array];
  for (NSString *pair in [cookieHeader componentsSeparatedByString:@";"]) {
    NSRange separator = [pair rangeOfString:@"="];
    if (separator.location == NSNotFound) {
      continue;
    }
    NSCharacterSet *whitespace = NSCharacterSet.whitespaceCharacterSet;
    NSString *name = [[pair substringToIndex:separator.location] stringByTrimmingCharactersInSet:whitespace];
    NSString *value = [[pair substringFromIndex:separator.location + 1] stringByTrimmingCharactersInSet:whitespace];
    if (name.length == 0) {
      continue;
    }
    NSMutableDictionary *properties = [@{
      NSHTTPCookieName : name,
      NSHTTPCookieValue : value,
      NSHTTPCookieDomain : url.host,
      NSHTTPCookiePath : @"/",
    } mutableCopy];
    if ([url.scheme isEqualToString:@"https"]) {
      properties[NSHTTPCookieSecure] = @"TRUE";
    }
    NSHTTPCookie *cookie = [NSHTTPCookie cookieWithProperties:properties];
    if (cookie != nil) {
      [cookies addObject:cookie];
    }
  }
  return cookies;
}

@end
