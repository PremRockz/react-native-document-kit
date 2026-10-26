#import "DocumentKitPresenter.h"

#import <React/RCTUtils.h>

// One wait per running transition is enough; the cap only guards against a loop.
static const NSInteger DocumentKitMaxPresentAttempts = 3;

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
  [presenter presentViewController:viewController animated:YES completion:nil];
  // UIKit sets this at once when it accepts the presentation, and leaves it nil when it refuses.
  if (viewController.presentingViewController == nil) {
    onFailure();
  }
}

@end
