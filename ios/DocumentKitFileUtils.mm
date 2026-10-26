#import "DocumentKitFileUtils.h"

#import <AVFoundation/AVFoundation.h>
#import <ImageIO/ImageIO.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

static NSString *const DocumentKitRootDirectoryName = @"document-kit";
static NSString *const DocumentKitErrorDomain = @"com.documentkit";
static NSString *const DocumentKitFallbackMimeType = @"application/octet-stream";
// Only used when a HEIC/HEIF image has to be re-encoded.
static const CGFloat DocumentKitJPEGQuality = 0.9;

@implementation DocumentKitFileUtils

+ (nullable NSURL *)rootDirectoryWithError:(NSError **)error
{
  NSURL *caches = [NSFileManager.defaultManager URLsForDirectory:NSCachesDirectory inDomains:NSUserDomainMask].firstObject;
  NSURL *root = [caches URLByAppendingPathComponent:DocumentKitRootDirectoryName isDirectory:YES];
  BOOL created = [NSFileManager.defaultManager createDirectoryAtURL:root
                                        withIntermediateDirectories:YES
                                                         attributes:nil
                                                              error:error];
  return created ? root : nil;
}

+ (nullable NSURL *)uniqueDirectoryWithError:(NSError **)error
{
  NSURL *root = [self rootDirectoryWithError:error];
  if (root == nil) {
    return nil;
  }
  NSURL *directory = [root URLByAppendingPathComponent:NSUUID.UUID.UUIDString isDirectory:YES];
  BOOL created = [NSFileManager.defaultManager createDirectoryAtURL:directory
                                        withIntermediateDirectories:YES
                                                         attributes:nil
                                                              error:error];
  return created ? directory : nil;
}

+ (NSString *)timestampedName:(NSString *)prefix extension:(NSString *)extension
{
  long long milliseconds = (long long)(NSDate.date.timeIntervalSince1970 * 1000);
  return [NSString stringWithFormat:@"%@_%lld.%@", prefix, milliseconds, extension];
}

+ (nullable NSURL *)convertImageToJPEG:(NSURL *)sourceURL error:(NSError **)error
{
  CGImageSourceRef source = CGImageSourceCreateWithURL((__bridge CFURLRef)sourceURL, NULL);
  if (source == NULL) {
    if (error) {
      *error = [self errorWithMessage:@"Could not read the image"];
    }
    return nil;
  }

  NSURL *destinationURL = [[sourceURL URLByDeletingPathExtension] URLByAppendingPathExtension:@"jpg"];
  CGImageDestinationRef destination = CGImageDestinationCreateWithURL(
      (__bridge CFURLRef)destinationURL, (__bridge CFStringRef)UTTypeJPEG.identifier, 1, NULL);
  if (destination == NULL) {
    CFRelease(source);
    if (error) {
      *error = [self errorWithMessage:@"Could not create the JPEG file"];
    }
    return nil;
  }

  // Copies the original metadata, including orientation.
  NSDictionary *options = @{(__bridge NSString *)kCGImageDestinationLossyCompressionQuality : @(DocumentKitJPEGQuality)};
  CGImageDestinationAddImageFromSource(destination, source, 0, (__bridge CFDictionaryRef)options);
  BOOL finalized = CGImageDestinationFinalize(destination);
  CFRelease(destination);
  CFRelease(source);

  if (!finalized) {
    if (error) {
      *error = [self errorWithMessage:@"Could not write the JPEG file"];
    }
    return nil;
  }
  [NSFileManager.defaultManager removeItemAtURL:sourceURL error:nil];
  return destinationURL;
}

+ (nullable NSURL *)exportVideoToMP4:(NSURL *)sourceURL
                         destination:(NSURL *)destinationURL
                               error:(NSError **)error
{
  AVURLAsset *asset = [AVURLAsset URLAssetWithURL:sourceURL options:nil];
  AVAssetExportSession *session = [[AVAssetExportSession alloc] initWithAsset:asset
                                                                   presetName:AVAssetExportPresetPassthrough];
  if (session == nil) {
    if (error) {
      *error = [self errorWithMessage:@"Could not start the MP4 export"];
    }
    return nil;
  }
  session.outputURL = destinationURL;
  session.outputFileType = AVFileTypeMPEG4;
  session.shouldOptimizeForNetworkUse = YES;

  dispatch_semaphore_t done = dispatch_semaphore_create(0);
  [session exportAsynchronouslyWithCompletionHandler:^{
    dispatch_semaphore_signal(done);
  }];
  dispatch_semaphore_wait(done, DISPATCH_TIME_FOREVER);

  if (session.status != AVAssetExportSessionStatusCompleted) {
    if (error) {
      *error = session.error ?: [self errorWithMessage:@"The MP4 export did not complete"];
    }
    return nil;
  }
  return destinationURL;
}

+ (NSDictionary *)describeFileAtURL:(NSURL *)url
{
  NSString *extension = url.pathExtension.lowercaseString;
  UTType *type = [UTType typeWithFilenameExtension:extension];
  NSString *mimeType = type.preferredMIMEType ?: DocumentKitFallbackMimeType;
  NSNumber *size = [NSFileManager.defaultManager attributesOfItemAtPath:url.path error:nil][NSFileSize] ?: @0;

  NSMutableDictionary *file = [@{
    @"uri" : url.absoluteString,
    @"name" : url.lastPathComponent,
    @"mimeType" : mimeType,
    @"size" : size,
  } mutableCopy];

  if ([type conformsToType:UTTypeImage]) {
    [file addEntriesFromDictionary:[self imageDetailsAtURL:url]];
  } else if ([type conformsToType:UTTypeMovie]) {
    [file addEntriesFromDictionary:[self videoDetailsAtURL:url]];
  }
  return file;
}

+ (NSError *)errorWithMessage:(NSString *)message
{
  return [NSError errorWithDomain:DocumentKitErrorDomain code:1 userInfo:@{NSLocalizedDescriptionKey : message}];
}

#pragma mark - Private

+ (NSDictionary *)imageDetailsAtURL:(NSURL *)url
{
  CGImageSourceRef source = CGImageSourceCreateWithURL((__bridge CFURLRef)url, NULL);
  if (source == NULL) {
    return @{};
  }
  NSDictionary *properties = CFBridgingRelease(CGImageSourceCopyPropertiesAtIndex(source, 0, NULL));
  CFRelease(source);

  NSNumber *width = properties[(__bridge NSString *)kCGImagePropertyPixelWidth];
  NSNumber *height = properties[(__bridge NSString *)kCGImagePropertyPixelHeight];
  if (width == nil || height == nil) {
    return @{};
  }
  // EXIF orientations 5–8 are rotated by 90°, so the displayed width is the stored height.
  NSInteger orientation = [properties[(__bridge NSString *)kCGImagePropertyOrientation] integerValue];
  BOOL isRotated = orientation >= 5 && orientation <= 8;
  return @{
    @"width" : isRotated ? height : width,
    @"height" : isRotated ? width : height,
  };
}

+ (NSDictionary *)videoDetailsAtURL:(NSURL *)url
{
  AVURLAsset *asset = [AVURLAsset URLAssetWithURL:url options:nil];
  NSMutableDictionary *details = [NSMutableDictionary dictionary];

  Float64 seconds = CMTimeGetSeconds(asset.duration);
  if (isfinite(seconds)) {
    details[@"durationMs"] = @(seconds * 1000);
  }

  AVAssetTrack *track = [asset tracksWithMediaType:AVMediaTypeVideo].firstObject;
  if (track != nil) {
    CGSize size = CGSizeApplyAffineTransform(track.naturalSize, track.preferredTransform);
    details[@"width"] = @(fabs(size.width));
    details[@"height"] = @(fabs(size.height));
  }
  return details;
}

@end
