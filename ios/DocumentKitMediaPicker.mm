#import "DocumentKitMediaPicker.h"

#import <PhotosUI/PhotosUI.h>
#import <React/RCTUtils.h>
#import <UIKit/UIKit.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

#import "DocumentKitFileUtils.h"
#import "DocumentKitPresenter.h"

static NSString *const DocumentKitMediaTypePhoto = @"photo";
static NSString *const DocumentKitMediaTypeVideo = @"video";
static NSString *const DocumentKitVideoQualityLow = @"low";
static NSString *const DocumentKitVideoQualityMedium = @"medium";

static NSString *const DocumentKitErrorBusy = @"E_BUSY";
static NSString *const DocumentKitErrorUnavailable = @"E_UNAVAILABLE";
static NSString *const DocumentKitErrorNoPresenter = @"E_NO_ACTIVITY";
static NSString *const DocumentKitErrorCaptureFailed = @"E_CAPTURE_FAILED";
static const CGFloat DocumentKitSystemCameraJPEGQuality = 0.9;
static NSString *const DocumentKitErrorPickFailed = @"E_PICK_FAILED";

@interface DocumentKitMediaPicker () <UIImagePickerControllerDelegate,
                                  UINavigationControllerDelegate,
                                  PHPickerViewControllerDelegate,
                                  UIDocumentPickerDelegate>
@end

@implementation DocumentKitMediaPicker {
  // Set while a picker is on screen; cleared before the promise settles so it settles once.
  RCTPromiseResolveBlock _pendingResolve;
  RCTPromiseRejectBlock _pendingReject;
}

RCT_EXPORT_MODULE()

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

#pragma mark - Spec

- (void)captureWithSystemCamera:(NSString *)mediaType
                   videoQuality:(NSString *)videoQuality
             maxDurationSeconds:(double)maxDurationSeconds
                        resolve:(RCTPromiseResolveBlock)resolve
                         reject:(RCTPromiseRejectBlock)reject
{
  dispatch_async(dispatch_get_main_queue(), ^{
    if (![UIImagePickerController isSourceTypeAvailable:UIImagePickerControllerSourceTypeCamera]) {
      reject(DocumentKitErrorUnavailable, @"This device has no camera", nil);
      return;
    }

    UIImagePickerController *picker = [UIImagePickerController new];
    picker.sourceType = UIImagePickerControllerSourceTypeCamera;
    picker.delegate = self;
    picker.modalPresentationStyle = UIModalPresentationFullScreen;
    if ([mediaType isEqualToString:DocumentKitMediaTypeVideo]) {
      picker.mediaTypes = @[ UTTypeMovie.identifier ];
      picker.cameraCaptureMode = UIImagePickerControllerCameraCaptureModeVideo;
      picker.videoQuality = [self imagePickerQualityFor:videoQuality];
      if (maxDurationSeconds > 0) {
        picker.videoMaximumDuration = maxDurationSeconds;
      }
    } else {
      picker.mediaTypes = @[ UTTypeImage.identifier ];
      picker.cameraCaptureMode = UIImagePickerControllerCameraCaptureModePhoto;
    }

    [self present:picker resolve:resolve reject:reject];
  });
}

- (void)pickFromLibrary:(NSString *)mediaType
         selectionLimit:(double)selectionLimit
                resolve:(RCTPromiseResolveBlock)resolve
                 reject:(RCTPromiseRejectBlock)reject
{
  dispatch_async(dispatch_get_main_queue(), ^{
    // Created without a photo library, so no photo permission is needed.
    PHPickerConfiguration *configuration = [PHPickerConfiguration new];
    configuration.selectionLimit = (NSInteger)MAX(selectionLimit, 0); // 0 = no limit
    configuration.filter = [self pickerFilterFor:mediaType];
    // Lets iOS hand back JPEG/H.264 instead of HEIC/HEVC where it can.
    configuration.preferredAssetRepresentationMode = PHPickerConfigurationAssetRepresentationModeCompatible;

    PHPickerViewController *picker = [[PHPickerViewController alloc] initWithConfiguration:configuration];
    picker.delegate = self;
    [self present:picker resolve:resolve reject:reject];
  });
}

- (void)pickDocuments:(NSArray *)mimeTypes
        allowMultiple:(BOOL)allowMultiple
              resolve:(RCTPromiseResolveBlock)resolve
               reject:(RCTPromiseRejectBlock)reject
{
  dispatch_async(dispatch_get_main_queue(), ^{
    // asCopy: iOS downloads iCloud files and hands over copies, so no security-scoped access is needed.
    UIDocumentPickerViewController *picker =
        [[UIDocumentPickerViewController alloc] initForOpeningContentTypes:[self contentTypesFor:mimeTypes] asCopy:YES];
    picker.allowsMultipleSelection = allowMultiple;
    picker.delegate = self;
    [self present:picker resolve:resolve reject:reject];
  });
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeDocumentKitMediaPickerSpecJSI>(params);
}

#pragma mark - UIImagePickerControllerDelegate

- (void)imagePickerControllerDidCancel:(UIImagePickerController *)picker
{
  [picker dismissViewControllerAnimated:YES completion:nil];
  [self resolveFiles:@[]];
}

- (void)imagePickerController:(UIImagePickerController *)picker
    didFinishPickingMediaWithInfo:(NSDictionary<UIImagePickerControllerInfoKey, id> *)info
{
  NSURL *videoURL = info[UIImagePickerControllerMediaURL];
  UIImage *image = info[UIImagePickerControllerOriginalImage];
  [picker dismissViewControllerAnimated:YES completion:nil];

  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    NSError *error = nil;
    NSURL *fileURL = videoURL != nil ? [self storeCapturedVideo:videoURL error:&error]
                                     : [self storeCapturedImage:image error:&error];
    if (fileURL == nil) {
      [self rejectWithCode:DocumentKitErrorCaptureFailed message:@"Could not save the captured file" error:error];
      return;
    }
    [self resolveFiles:@[ [DocumentKitFileUtils describeFileAtURL:fileURL] ]];
  });
}

#pragma mark - PHPickerViewControllerDelegate

- (void)picker:(PHPickerViewController *)picker didFinishPicking:(NSArray<PHPickerResult *> *)results
{
  [picker dismissViewControllerAnimated:YES completion:nil];
  if (results.count == 0) {
    [self resolveFiles:@[]];
    return;
  }

  // Keep the user's selection order: each slot is filled by its own loader.
  NSMutableArray *files = [NSMutableArray arrayWithCapacity:results.count];
  for (NSUInteger index = 0; index < results.count; index++) {
    [files addObject:NSNull.null];
  }
  __block NSError *firstError = nil;
  NSObject *lock = [NSObject new];
  dispatch_group_t group = dispatch_group_create();

  [results enumerateObjectsUsingBlock:^(PHPickerResult *result, NSUInteger index, BOOL *stop) {
    dispatch_group_enter(group);
    [self loadItem:result.itemProvider
        completion:^(NSURL *fileURL, NSError *error) {
          @synchronized(lock) {
            if (fileURL != nil) {
              files[index] = [DocumentKitFileUtils describeFileAtURL:fileURL];
            } else if (firstError == nil) {
              firstError = error ?: [DocumentKitFileUtils errorWithMessage:@"Could not load the selected file"];
            }
          }
          dispatch_group_leave(group);
        }];
  }];

  dispatch_group_notify(group, dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    if (firstError != nil) {
      [self rejectWithCode:DocumentKitErrorPickFailed message:@"Could not load the selected file" error:firstError];
      return;
    }
    [self resolveFiles:files];
  });
}

#pragma mark - UIDocumentPickerDelegate

- (void)documentPickerWasCancelled:(UIDocumentPickerViewController *)controller
{
  [self resolveFiles:@[]];
}

- (void)documentPicker:(UIDocumentPickerViewController *)controller didPickDocumentsAtURLs:(NSArray<NSURL *> *)urls
{
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    NSMutableArray *files = [NSMutableArray arrayWithCapacity:urls.count];
    for (NSURL *pickedURL in urls) {
      NSError *error = nil;
      NSURL *copiedURL = [self copyPickedFile:pickedURL suggestedName:nil error:&error];
      if (copiedURL == nil) {
        [self rejectWithCode:DocumentKitErrorPickFailed message:@"Could not copy the selected file" error:error];
        return;
      }
      // The picker's own copy lives in tmp; ours in Caches/document-kit replaces it.
      [NSFileManager.defaultManager removeItemAtURL:pickedURL error:nil];
      [files addObject:[DocumentKitFileUtils describeFileAtURL:copiedURL]];
    }
    [self resolveFiles:files];
  });
}

#pragma mark - Loading and storing

/// iOS deletes the provided file when the handler returns, so it is copied inside the handler.
- (void)loadItem:(NSItemProvider *)provider completion:(void (^)(NSURL *_Nullable, NSError *_Nullable))completion
{
  BOOL isVideo = [provider hasItemConformingToTypeIdentifier:UTTypeMovie.identifier];
  NSString *typeIdentifier = isVideo ? UTTypeMovie.identifier : UTTypeImage.identifier;
  NSString *suggestedName = provider.suggestedName;

  [provider loadFileRepresentationForTypeIdentifier:typeIdentifier
                                  completionHandler:^(NSURL *_Nullable sourceURL, NSError *_Nullable loadError) {
                                    if (sourceURL == nil) {
                                      completion(nil, loadError);
                                      return;
                                    }
                                    NSError *error = nil;
                                    NSURL *copiedURL = [self copyPickedFile:sourceURL suggestedName:suggestedName error:&error];
                                    if (copiedURL == nil) {
                                      completion(nil, error);
                                      return;
                                    }
                                    NSURL *normalizedURL = isVideo ? [self normalizeVideo:copiedURL error:&error]
                                                                   : [self normalizeImage:copiedURL error:&error];
                                    completion(normalizedURL, error);
                                  }];
}

- (nullable NSURL *)copyPickedFile:(NSURL *)sourceURL suggestedName:(nullable NSString *)suggestedName error:(NSError **)error
{
  NSURL *directory = [DocumentKitFileUtils uniqueDirectoryWithError:error];
  if (directory == nil) {
    return nil;
  }
  NSString *extension = sourceURL.pathExtension.length > 0 ? sourceURL.pathExtension : @"bin";
  NSString *baseName = suggestedName.length > 0 ? suggestedName : sourceURL.URLByDeletingPathExtension.lastPathComponent;
  NSURL *targetURL = [directory URLByAppendingPathComponent:[baseName stringByAppendingPathExtension:extension]];
  BOOL copied = [NSFileManager.defaultManager copyItemAtURL:sourceURL toURL:targetURL error:error];
  return copied ? targetURL : nil;
}

/// HEIC/HEIF become JPEG so the server and Android viewers can open them.
- (nullable NSURL *)normalizeImage:(NSURL *)imageURL error:(NSError **)error
{
  NSString *extension = imageURL.pathExtension.lowercaseString;
  if ([extension isEqualToString:@"heic"] || [extension isEqualToString:@"heif"]) {
    return [DocumentKitFileUtils convertImageToJPEG:imageURL error:error];
  }
  return imageURL;
}

- (nullable NSURL *)normalizeVideo:(NSURL *)videoURL error:(NSError **)error
{
  if ([videoURL.pathExtension.lowercaseString isEqualToString:@"mp4"]) {
    return videoURL;
  }
  NSURL *mp4URL = [[videoURL URLByDeletingPathExtension] URLByAppendingPathExtension:@"mp4"];
  NSURL *exportedURL = [DocumentKitFileUtils exportVideoToMP4:videoURL destination:mp4URL error:error];
  if (exportedURL != nil) {
    [NSFileManager.defaultManager removeItemAtURL:videoURL error:nil];
  }
  return exportedURL;
}

- (nullable NSURL *)storeCapturedImage:(nullable UIImage *)image error:(NSError **)error
{
  // The JPEG keeps the photo's orientation in its EXIF data.
  // 0.9 looks the same as 1.0 at a fraction of the size (and of the memory spike).
  NSData *data = image != nil ? UIImageJPEGRepresentation(image, DocumentKitSystemCameraJPEGQuality) : nil;
  NSURL *directory = data != nil ? [DocumentKitFileUtils rootDirectoryWithError:error] : nil;
  if (directory == nil) {
    if (error != NULL && *error == nil) {
      *error = [DocumentKitFileUtils errorWithMessage:@"The camera returned no image"];
    }
    return nil;
  }
  NSURL *targetURL = [directory URLByAppendingPathComponent:[DocumentKitFileUtils timestampedName:@"Image" extension:@"jpg"]];
  BOOL written = [data writeToURL:targetURL options:NSDataWritingAtomic error:error];
  return written ? targetURL : nil;
}

- (nullable NSURL *)storeCapturedVideo:(NSURL *)videoURL error:(NSError **)error
{
  NSURL *directory = [DocumentKitFileUtils rootDirectoryWithError:error];
  if (directory == nil) {
    return nil;
  }
  NSURL *targetURL = [directory URLByAppendingPathComponent:[DocumentKitFileUtils timestampedName:@"Video" extension:@"mp4"]];
  NSURL *exported = [DocumentKitFileUtils exportVideoToMP4:videoURL destination:targetURL error:error];
  // The camera's own .MOV in tmp is no longer needed either way.
  [NSFileManager.defaultManager removeItemAtURL:videoURL error:nil];
  return exported;
}

#pragma mark - Promise handling

- (void)present:(UIViewController *)picker resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  @synchronized(self) {
    if (_pendingResolve != nil) {
      reject(DocumentKitErrorBusy, @"Another DocumentKit picker is already open", nil);
      return;
    }
    _pendingResolve = resolve;
    _pendingReject = reject;
  }
  [DocumentKitPresenter present:picker
                      onFailure:^{
                        [self rejectWithCode:DocumentKitErrorNoPresenter
                                     message:@"No view controller to present the picker from"
                                       error:nil];
                      }];
}

- (void)resolveFiles:(NSArray *)files
{
  RCTPromiseResolveBlock resolve = [self takePendingResolve];
  if (resolve != nil) {
    resolve(@{@"cancelled" : @(files.count == 0), @"files" : files});
  }
}

- (void)rejectWithCode:(NSString *)code message:(NSString *)message error:(nullable NSError *)error
{
  RCTPromiseRejectBlock reject = nil;
  @synchronized(self) {
    reject = _pendingReject;
    _pendingResolve = nil;
    _pendingReject = nil;
  }
  if (reject != nil) {
    reject(code, message, error);
  }
}

- (nullable RCTPromiseResolveBlock)takePendingResolve
{
  @synchronized(self) {
    RCTPromiseResolveBlock resolve = _pendingResolve;
    _pendingResolve = nil;
    _pendingReject = nil;
    return resolve;
  }
}

#pragma mark - Option mapping

- (UIImagePickerControllerQualityType)imagePickerQualityFor:(NSString *)videoQuality
{
  if ([videoQuality isEqualToString:DocumentKitVideoQualityLow]) {
    return UIImagePickerControllerQualityTypeLow;
  }
  if ([videoQuality isEqualToString:DocumentKitVideoQualityMedium]) {
    return UIImagePickerControllerQualityTypeMedium;
  }
  return UIImagePickerControllerQualityTypeHigh;
}

/// Maps MIME types (wildcards allowed) to content types; anything unknown or empty means every file.
- (NSArray<UTType *> *)contentTypesFor:(NSArray *)mimeTypes
{
  NSDictionary<NSString *, UTType *> *wildcards = @{
    @"image/*" : UTTypeImage,
    @"video/*" : UTTypeMovie,
    @"audio/*" : UTTypeAudio,
    @"text/*" : UTTypeText,
  };
  NSMutableArray<UTType *> *types = [NSMutableArray array];
  for (id mimeType in mimeTypes) {
    if (![mimeType isKindOfClass:NSString.class] || [mimeType isEqualToString:@"*/*"]) {
      continue;
    }
    UTType *type = wildcards[mimeType] ?: [UTType typeWithMIMEType:mimeType];
    if (type != nil) {
      [types addObject:type];
    }
  }
  return types.count > 0 ? types : @[ UTTypeItem ];
}

- (PHPickerFilter *)pickerFilterFor:(NSString *)mediaType
{
  if ([mediaType isEqualToString:DocumentKitMediaTypePhoto]) {
    return PHPickerFilter.imagesFilter;
  }
  if ([mediaType isEqualToString:DocumentKitMediaTypeVideo]) {
    return PHPickerFilter.videosFilter;
  }
  return [PHPickerFilter anyFilterMatchingSubfilters:@[ PHPickerFilter.imagesFilter, PHPickerFilter.videosFilter ]];
}

@end
