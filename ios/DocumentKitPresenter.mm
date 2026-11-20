#import "DocumentKitPresenter.h"

#import <React/RCTUtils.h>

// One wait per running transition is enough; the cap only guards against a loop.
static const NSInteger DocumentKitMaxPresentAttempts = 3;
// How long a screen may take to appear before it counts as refused; the photo
// picker's out-of-process view can take a second or more to start cold.
static const NSTimeInterval DocumentKitPresentTimeoutSeconds = 10;

@implementation DocumentKitPresenter

+ (void)present:(UIViewController *)viewController onFailure:(void (^)(void))onFailure
{
  [self present:viewController attempt:1 onFailure:onFailure];
}

+ (void)present:(UIViewController *)viewController attempt:(NSInteger)attempt onFailure:(void (^)(void))onFailure
{
  UIViewController *presenter = RCTPresentedViewController();
  if (presenter == nil) {
    onFailure();
    return;
  }
  // RCTPresentedViewController stops below a screen that is closing, so a picker
  // that just closed is the presenter's presentedViewController, still animating out.
  UIViewController *closing = presenter.presentedViewController;
  UIViewController *animating = nil;
  if (closing.isBeingDismissed) {
    animating = closing;
  } else if (presenter.isBeingPresented || presenter.isBeingDismissed) {
    animating = presenter;
  }
  id<UIViewControllerTransitionCoordinator> coordinator = animating.transitionCoordinator;
  if (coordinator != nil && attempt < DocumentKitMaxPresentAttempts) {
    [coordinator animateAlongsideTransition:nil
                                 completion:^(id<UIViewControllerTransitionCoordinatorContext> context) {
                                   // After the transition: the screen that closed is no longer on top.
                                   dispatch_async(dispatch_get_main_queue(), ^{
                                     [self present:viewController attempt:attempt + 1 onFailure:onFailure];
                                   });
                                 }];
    return;
  }
  // UIKit refuses, without an error, to present from a screen that is not on screen
  // or that already shows another one; check that up front.
  if (presenter.viewIfLoaded.window == nil ||
      (presenter.presentedViewController != nil && !presenter.presentedViewController.isBeingDismissed)) {
    onFailure();
    return;
  }
  __block BOOL isPresented = NO;
  [presenter presentViewController:viewController
                          animated:YES
                        completion:^{
                          isPresented = YES;
                        }];
  // Some screens appear later than this call: PHPickerViewController waits for its
  // out-of-process view (iOS 26), so presentingViewController is still nil here.
  // Only a screen that never appeared counts as refused.
  __weak UIViewController *weakViewController = viewController;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(DocumentKitPresentTimeoutSeconds * NSEC_PER_SEC)),
                 dispatch_get_main_queue(), ^{
                   UIViewController *shown = weakViewController;
                   if (!isPresented && shown != nil && shown.presentingViewController == nil &&
                       shown.viewIfLoaded.window == nil) {
                     onFailure();
                   }
                 });
}

@end
