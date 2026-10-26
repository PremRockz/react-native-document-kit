#import "DocumentKitPermissions.h"

#import <AVFoundation/AVFoundation.h>
#import <UIKit/UIKit.h>
#import <UserNotifications/UserNotifications.h>

static NSString *const DocumentKitStatusGranted = @"granted";
static NSString *const DocumentKitStatusPromptable = @"promptable";
static NSString *const DocumentKitStatusBlocked = @"blocked";
static NSString *const DocumentKitStatusUnavailable = @"unavailable";

// iOS shows each prompt only once, so anything other than "not determined"
// or "authorized" can only be changed in Settings.
static NSString *DocumentKitCaptureStatus(AVMediaType mediaType)
{
  if ([AVCaptureDevice defaultDeviceWithMediaType:mediaType] == nil) {
    return DocumentKitStatusUnavailable;
  }
  switch ([AVCaptureDevice authorizationStatusForMediaType:mediaType]) {
    case AVAuthorizationStatusAuthorized:
      return DocumentKitStatusGranted;
    case AVAuthorizationStatusNotDetermined:
      return DocumentKitStatusPromptable;
    case AVAuthorizationStatusDenied:
    case AVAuthorizationStatusRestricted:
    default:
      return DocumentKitStatusBlocked;
  }
}

@implementation DocumentKitPermissions

RCT_EXPORT_MODULE()

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (void)getCameraPermissionStatus:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  resolve(DocumentKitCaptureStatus(AVMediaTypeVideo));
}

- (void)requestCameraPermission:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [self requestAccessForMediaType:AVMediaTypeVideo resolve:resolve];
}

- (void)getMicrophonePermissionStatus:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  resolve(DocumentKitCaptureStatus(AVMediaTypeAudio));
}

- (void)requestMicrophonePermission:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [self requestAccessForMediaType:AVMediaTypeAudio resolve:resolve];
}

- (void)getNotificationPermissionStatus:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [UNUserNotificationCenter.currentNotificationCenter
      getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *settings) {
        resolve([self statusForNotificationSettings:settings]);
      }];
}

- (void)requestNotificationPermission:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  UNUserNotificationCenter *center = UNUserNotificationCenter.currentNotificationCenter;
  [center getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *settings) {
    NSString *currentStatus = [self statusForNotificationSettings:settings];
    if (![currentStatus isEqualToString:DocumentKitStatusPromptable]) {
      resolve(currentStatus);
      return;
    }
    [center requestAuthorizationWithOptions:(UNAuthorizationOptionAlert | UNAuthorizationOptionSound)
                          completionHandler:^(BOOL granted, NSError *error) {
                            resolve(granted ? DocumentKitStatusGranted : DocumentKitStatusBlocked);
                          }];
  }];
}

- (NSString *)statusForNotificationSettings:(UNNotificationSettings *)settings
{
  switch (settings.authorizationStatus) {
    case UNAuthorizationStatusAuthorized:
    case UNAuthorizationStatusProvisional:
    case UNAuthorizationStatusEphemeral:
      return DocumentKitStatusGranted;
    case UNAuthorizationStatusNotDetermined:
      return DocumentKitStatusPromptable;
    case UNAuthorizationStatusDenied:
    default:
      return DocumentKitStatusBlocked;
  }
}

/// Shows the prompt only when iOS still can; resolves the resulting status.
- (void)requestAccessForMediaType:(AVMediaType)mediaType resolve:(RCTPromiseResolveBlock)resolve
{
  NSString *currentStatus = DocumentKitCaptureStatus(mediaType);
  if (![currentStatus isEqualToString:DocumentKitStatusPromptable]) {
    resolve(currentStatus);
    return;
  }
  [AVCaptureDevice requestAccessForMediaType:mediaType
                           completionHandler:^(BOOL granted) {
                             resolve(granted ? DocumentKitStatusGranted : DocumentKitStatusBlocked);
                           }];
}

- (void)openSettings:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  dispatch_async(dispatch_get_main_queue(), ^{
    NSURL *settingsUrl = [NSURL URLWithString:UIApplicationOpenSettingsURLString];
    [[UIApplication sharedApplication] openURL:settingsUrl
                                       options:@{}
                             completionHandler:^(BOOL success) {
                               if (success) {
                                 resolve(nil);
                               } else {
                                 reject(@"E_OPEN_SETTINGS", @"Could not open app settings", nil);
                               }
                             }];
  });
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeDocumentKitPermissionsSpecJSI>(params);
}

@end
