#import <AVFoundation/AVFoundation.h>
#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * DocumentKit's full-screen video/audio player: title with length and size,
 * back 5 s / play / forward 15 s, seek bar, speed, sound, full screen and an
 * optional Download button (Save to Files). The same design as Android's.
 */
@interface DocumentKitPlayerViewController : UIViewController

/// `labels` uses NativePreviewLabels' keys; `headers` are sent when Download fetches a stream.
- (instancetype)initWithAsset:(AVURLAsset *)asset
                     mediaURL:(NSURL *)mediaURL
                      headers:(NSDictionary<NSString *, NSString *> *)headers
                        title:(NSString *)title
                     mimeType:(NSString *)mimeType
                       labels:(NSDictionary<NSString *, NSString *> *)labels
                  accentColor:(nullable UIColor *)accentColor
                        muted:(BOOL)muted
                      canSave:(BOOL)canSave NS_DESIGNATED_INITIALIZER;

- (instancetype)initWithNibName:(nullable NSString *)nibNameOrNil bundle:(nullable NSBundle *)nibBundleOrNil NS_UNAVAILABLE;
- (instancetype)initWithCoder:(NSCoder *)coder NS_UNAVAILABLE;

@property (nonatomic, readonly) AVPlayer *player;
/// Where playback starts, e.g. when reopened with fresh headers after a 401. Set before presenting.
@property (nonatomic) double startPositionMs;
/// Set before presenting. NO opens paused, with the controls showing. Defaults to YES.
@property (nonatomic) BOOL autoPlay;
/// Set before presenting: the back / forward jumps; 0 hides that button. Default 5 and 15.
@property (nonatomic) NSInteger skipBackSeconds;
@property (nonatomic) NSInteger skipForwardSeconds;
/// Set before presenting: the speed and full-screen buttons. Default YES.
@property (nonatomic) BOOL allowSpeed;
@property (nonatomic) BOOL allowFullScreen;
/**
 * Called once, when the player has closed: "closed", or "unauthorized" when the
 * server answered 401/403 (the player closes itself so JS can refresh the session).
 */
@property (nonatomic, copy, nullable) void (^onFinish)(NSString *outcome, double positionMs, NSInteger httpStatus);

@end

NS_ASSUME_NONNULL_END
