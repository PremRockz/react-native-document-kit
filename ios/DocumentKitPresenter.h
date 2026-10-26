#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

/// Presents DocumentKit's screens (pickers, previews, Save to Files) over the app.
@interface DocumentKitPresenter : NSObject

/**
 * Presents `viewController` from the topmost screen. When that screen is still
 * animating in or out (a picker that just closed), waits for the animation to
 * end first: UIKit silently refuses to present in the middle of one, which would
 * leave the caller's promise pending forever. Calls `onFailure` when there is
 * nothing to present from or UIKit refused. Main thread only.
 */
+ (void)present:(UIViewController *)viewController onFailure:(void (^)(void))onFailure;

@end

NS_ASSUME_NONNULL_END
