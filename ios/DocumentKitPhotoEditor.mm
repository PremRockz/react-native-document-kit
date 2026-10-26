#import "DocumentKitPhotoEditor.h"

#import <ImageIO/ImageIO.h>
#import <UIKit/UIKit.h>

#import "DocumentKitFileUtils.h"

static const CGFloat DocumentKitDisplayCopyQuality = 0.85;
static const CGFloat DocumentKitEditedPhotoQuality = 0.92;
// About 64 MB as a bitmap: a photo to straighten is drawn from a copy no larger than this.
static const CGFloat DocumentKitMaxDecodedPixels = 16000000;
// Smaller turns are treated as none.
static const CGFloat DocumentKitMinStraightenDegrees = 0.05;

/// EXIF orientation (1, 6, 3, 8) as clockwise degrees; mirrored orientations count as unturned.
static NSInteger DocumentKitDegreesForOrientation(NSInteger orientation)
{
  switch (orientation) {
    case kCGImagePropertyOrientationRight:
      return 90;
    case kCGImagePropertyOrientationDown:
      return 180;
    case kCGImagePropertyOrientationLeft:
      return 270;
    default:
      return 0;
  }
}

/// EXIF orientation for turning `degrees` clockwise, then mirroring left to right when `isFlipped`.
static CGImagePropertyOrientation DocumentKitOrientationFor(NSInteger degrees, BOOL isFlipped)
{
  switch (degrees) {
    case 90:
      return isFlipped ? kCGImagePropertyOrientationLeftMirrored : kCGImagePropertyOrientationRight;
    case 180:
      return isFlipped ? kCGImagePropertyOrientationDownMirrored : kCGImagePropertyOrientationDown;
    case 270:
      return isFlipped ? kCGImagePropertyOrientationRightMirrored : kCGImagePropertyOrientationLeft;
    default:
      return isFlipped ? kCGImagePropertyOrientationUpMirrored : kCGImagePropertyOrientationUp;
  }
}

/// How much a `size` picture turned `degrees` must grow to still cover its own frame.
static CGFloat DocumentKitStraightenZoom(CGSize size, CGFloat degrees)
{
  CGFloat angle = fabs(degrees) * M_PI / 180;
  return MAX((size.width * cos(angle) + size.height * sin(angle)) / size.width,
             (size.width * sin(angle) + size.height * cos(angle)) / size.height);
}

/**
 * `crop` is in fractions of the photo as shown, which is the stored pixels
 * turned `rotation` clockwise; this maps it back onto the stored pixels.
 */
static CGRect DocumentKitRawCrop(CGRect crop, NSInteger rotation)
{
  CGFloat x = MIN(MAX(crop.origin.x, 0), 1);
  CGFloat y = MIN(MAX(crop.origin.y, 0), 1);
  CGFloat w = MIN(crop.size.width, 1 - x);
  CGFloat h = MIN(crop.size.height, 1 - y);
  switch (rotation) {
    case 90:
      return CGRectMake(y, 1 - x - w, h, w);
    case 180:
      return CGRectMake(1 - x - w, 1 - y - h, w, h);
    case 270:
      return CGRectMake(1 - y - h, x, h, w);
    default:
      return CGRectMake(x, y, w, h);
  }
}

static BOOL DocumentKitIsWhole(CGRect crop)
{
  // A null crop from JS arrives as an empty rectangle.
  return CGRectIsNull(crop) || crop.size.width <= 0 || crop.size.height <= 0 ||
      (crop.origin.x <= 0.001 && crop.origin.y <= 0.001 && CGRectGetMaxX(crop) >= 0.999 && CGRectGetMaxY(crop) >= 0.999);
}

@implementation DocumentKitPhotoEditor

+ (nullable NSURL *)newPhotoURLWithPrefix:(NSString *)prefix error:(NSError **)error
{
  NSURL *directory = [DocumentKitFileUtils rootDirectoryWithError:error];
  return directory ? [directory URLByAppendingPathComponent:[DocumentKitFileUtils timestampedName:prefix extension:@"jpg"]] : nil;
}

+ (BOOL)failWith:(NSString *)message error:(NSError **)error
{
  if (error != NULL) {
    *error = [DocumentKitFileUtils errorWithMessage:message];
  }
  return NO;
}

+ (nullable NSURL *)writeJPEG:(CGImageRef)image prefix:(NSString *)prefix error:(NSError **)error
{
  NSURL *url = [self newPhotoURLWithPrefix:prefix error:error];
  if (url == nil) {
    return nil;
  }
  NSDictionary *options = @{(id)kCGImageDestinationLossyCompressionQuality : @(DocumentKitDisplayCopyQuality)};
  return [self writeImage:image to:url options:options error:error] ? url : nil;
}

+ (BOOL)writeImage:(CGImageRef)image to:(NSURL *)url options:(NSDictionary *)options error:(NSError **)error
{
  CGImageDestinationRef destination = CGImageDestinationCreateWithURL((__bridge CFURLRef)url, CFSTR("public.jpeg"), 1, NULL);
  if (destination == NULL) {
    return [self failWith:@"Cannot create the image file" error:error];
  }
  CGImageDestinationAddImage(destination, image, (__bridge CFDictionaryRef)options);
  BOOL isWritten = CGImageDestinationFinalize(destination);
  CFRelease(destination);
  return isWritten ? YES : [self failWith:@"Cannot write the image file" error:error];
}

+ (nullable NSURL *)writeDisplayCopyOfPhoto:(NSURL *)photoURL maxPixels:(CGFloat)maxPixels error:(NSError **)error
{
  CGImageSourceRef source = CGImageSourceCreateWithURL((__bridge CFURLRef)photoURL, NULL);
  if (source == NULL) {
    [self failWith:@"Cannot read the photo" error:error];
    return nil;
  }
  NSDictionary *options = @{
    (id)kCGImageSourceCreateThumbnailFromImageAlways : @YES,
    (id)kCGImageSourceCreateThumbnailWithTransform : @YES,
    (id)kCGImageSourceThumbnailMaxPixelSize : @(maxPixels),
  };
  CGImageRef image = CGImageSourceCreateThumbnailAtIndex(source, 0, (__bridge CFDictionaryRef)options);
  CFRelease(source);
  if (image == NULL) {
    [self failWith:@"Cannot decode the photo" error:error];
    return nil;
  }
  NSURL *url = [self writeJPEG:image prefix:@"ImagePreview" error:error];
  CGImageRelease(image);
  return url;
}

+ (nullable NSDictionary *)editPhoto:(NSURL *)photoURL
                            rotation:(NSInteger)rotationDegrees
                           isFlipped:(BOOL)isFlipped
                          straighten:(CGFloat)straightenDegrees
                                crop:(CGRect)crop
                    maxDisplayPixels:(CGFloat)maxDisplayPixels
                               error:(NSError **)error
{
  CGImageSourceRef source = CGImageSourceCreateWithURL((__bridge CFURLRef)photoURL, NULL);
  if (source == NULL) {
    [self failWith:@"Cannot read the photo" error:error];
    return nil;
  }
  NSURL *outputURL = [self newPhotoURLWithPrefix:@"Image" error:error];
  BOOL isWritten = NO;
  // Only a JPEG can keep its pixels and take a new orientation; other formats
  // (library PNG, HEIC) are redrawn into a JPEG.
  CFStringRef type = CGImageSourceGetType(source);
  BOOL isJpeg = type != NULL && CFStringCompare(type, CFSTR("public.jpeg"), 0) == kCFCompareEqualTo;
  if (outputURL != nil && (fabs(straightenDegrees) >= DocumentKitMinStraightenDegrees || !isJpeg)) {
    isWritten = [self writeStraightenedFrom:source
                                   rotation:rotationDegrees
                                  isFlipped:isFlipped
                                 straighten:straightenDegrees
                                       crop:crop
                                         to:outputURL
                                      error:error];
  } else if (outputURL != nil) {
    isWritten = [self writeTurnedFrom:source rotation:rotationDegrees isFlipped:isFlipped crop:crop to:outputURL error:error];
  }
  CFRelease(source);
  if (!isWritten) {
    if (outputURL != nil) {
      [NSFileManager.defaultManager removeItemAtURL:outputURL error:nil];
    }
    return nil;
  }

  NSURL *displayURL = [self writeDisplayCopyOfPhoto:outputURL maxPixels:maxDisplayPixels error:error];
  if (displayURL == nil) {
    [NSFileManager.defaultManager removeItemAtURL:outputURL error:nil];
    return nil;
  }
  NSMutableDictionary *file = [[DocumentKitFileUtils describeFileAtURL:outputURL] mutableCopy];
  file[@"previewUri"] = displayURL.absoluteString;
  return file;
}

/// Rotation and flip as orientation metadata; a crop re-encodes only its pixels, kept unturned.
+ (BOOL)writeTurnedFrom:(CGImageSourceRef)source
               rotation:(NSInteger)rotationDegrees
              isFlipped:(BOOL)isFlipped
                   crop:(CGRect)crop
                     to:(NSURL *)outputURL
                  error:(NSError **)error
{
  NSDictionary *properties = (__bridge_transfer NSDictionary *)CGImageSourceCopyPropertiesAtIndex(source, 0, NULL);
  NSInteger originalRotation =
      DocumentKitDegreesForOrientation([properties[(id)kCGImagePropertyOrientation] integerValue]);
  NSInteger totalRotation = (((originalRotation + rotationDegrees) % 360) + 360) % 360;
  CGImagePropertyOrientation orientation = DocumentKitOrientationFor(totalRotation, isFlipped);

  if (DocumentKitIsWhole(crop)) {
    // Same pixels and metadata; only the orientation changes, so nothing is re-encoded.
    CGImageDestinationRef destination = CGImageDestinationCreateWithURL(
        (__bridge CFURLRef)outputURL, CGImageSourceGetType(source) ?: CFSTR("public.jpeg"), 1, NULL);
    if (destination == NULL) {
      return [self failWith:@"Cannot create the image file" error:error];
    }
    NSDictionary *options = @{(id)kCGImageDestinationOrientation : @(orientation)};
    CFErrorRef copyError = NULL;
    BOOL isCopied = CGImageDestinationCopyImageSource(destination, source, (__bridge CFDictionaryRef)options, &copyError);
    if (copyError != NULL) {
      CFRelease(copyError);
    }
    CFRelease(destination);
    return isCopied ? YES : [self failWith:@"Cannot rotate the photo" error:error];
  }

  CGImageRef image = CGImageSourceCreateImageAtIndex(source, 0, NULL);
  if (image == NULL) {
    return [self failWith:@"Cannot decode the photo" error:error];
  }
  // The crop is of the mirrored photo; mirror it back before mapping it onto the stored pixels.
  CGRect unmirrored = isFlipped ? CGRectMake(1 - CGRectGetMaxX(crop), crop.origin.y, crop.size.width, crop.size.height)
                                : crop;
  CGFloat width = CGImageGetWidth(image);
  CGFloat height = CGImageGetHeight(image);
  CGRect raw = DocumentKitRawCrop(unmirrored, totalRotation);
  CGRect pixels =
      CGRectIntegral(CGRectMake(raw.origin.x * width, raw.origin.y * height, raw.size.width * width, raw.size.height * height));
  CGImageRef cropped = CGImageCreateWithImageInRect(image, pixels);
  CGImageRelease(image);
  if (cropped == NULL) {
    return [self failWith:@"The crop is empty" error:error];
  }
  NSDictionary *options = @{
    (id)kCGImageDestinationLossyCompressionQuality : @(DocumentKitEditedPhotoQuality),
    (id)kCGImagePropertyOrientation : @(orientation),
  };
  BOOL isWritten = [self writeImage:cropped to:outputURL options:options error:error];
  CGImageRelease(cropped);
  return isWritten;
}

/**
 * Draws the upright photo turned, mirrored, straightened and cropped in one
 * pass, from a copy of at most about 16 MP, and writes the pixels upright.
 */
+ (BOOL)writeStraightenedFrom:(CGImageSourceRef)source
                     rotation:(NSInteger)rotationDegrees
                    isFlipped:(BOOL)isFlipped
                   straighten:(CGFloat)straightenDegrees
                         crop:(CGRect)crop
                           to:(NSURL *)outputURL
                        error:(NSError **)error
{
  NSDictionary *properties = (__bridge_transfer NSDictionary *)CGImageSourceCopyPropertiesAtIndex(source, 0, NULL);
  CGFloat storedWidth = [properties[(id)kCGImagePropertyPixelWidth] doubleValue];
  CGFloat storedHeight = [properties[(id)kCGImagePropertyPixelHeight] doubleValue];
  CGFloat longEdge = MAX(storedWidth, storedHeight);
  CGFloat shortEdge = MAX(MIN(storedWidth, storedHeight), 1);
  CGFloat maxEdge = MIN(longEdge, floor(sqrt(DocumentKitMaxDecodedPixels * longEdge / shortEdge)));
  NSDictionary *options = @{
    (id)kCGImageSourceCreateThumbnailFromImageAlways : @YES,
    (id)kCGImageSourceCreateThumbnailWithTransform : @YES,
    (id)kCGImageSourceThumbnailMaxPixelSize : @(MAX(maxEdge, 1)),
  };
  CGImageRef upright = CGImageSourceCreateThumbnailAtIndex(source, 0, (__bridge CFDictionaryRef)options);
  if (upright == NULL) {
    return [self failWith:@"Cannot decode the photo" error:error];
  }
  UIImage *photo = [UIImage imageWithCGImage:upright];
  CGImageRelease(upright);

  NSInteger rotation = ((rotationDegrees % 360) + 360) % 360;
  CGSize uprightSize = photo.size;
  CGSize turned = rotation % 180 == 0 ? uprightSize : CGSizeMake(uprightSize.height, uprightSize.width);
  CGSize resultSize = CGSizeMake(MAX(round(crop.size.width * turned.width), 1), MAX(round(crop.size.height * turned.height), 1));
  CGFloat zoom = DocumentKitStraightenZoom(turned, straightenDegrees);

  UIGraphicsImageRendererFormat *format = [UIGraphicsImageRendererFormat preferredFormat];
  format.scale = 1;
  format.opaque = YES;
  UIGraphicsImageRenderer *renderer = [[UIGraphicsImageRenderer alloc] initWithSize:resultSize format:format];
  UIImage *result = [renderer imageWithActions:^(UIGraphicsImageRendererContext *rendererContext) {
    CGContextRef context = rendererContext.CGContext;
    // JPEG has no transparency: a transparent PNG gets white, not black.
    [UIColor.whiteColor setFill];
    CGContextFillRect(context, CGRectMake(0, 0, resultSize.width, resultSize.height));
    // Each call applies to everything drawn after it, so the steps are listed last to first.
    CGContextTranslateCTM(context, -crop.origin.x * turned.width, -crop.origin.y * turned.height);
    CGContextTranslateCTM(context, turned.width / 2, turned.height / 2);
    CGContextRotateCTM(context, straightenDegrees * M_PI / 180);
    CGContextScaleCTM(context, zoom, zoom);
    CGContextTranslateCTM(context, -turned.width / 2, -turned.height / 2);
    if (isFlipped) {
      CGContextTranslateCTM(context, turned.width, 0);
      CGContextScaleCTM(context, -1, 1);
    }
    switch (rotation) {
      case 90:
        CGContextTranslateCTM(context, turned.width, 0);
        CGContextRotateCTM(context, M_PI_2);
        break;
      case 180:
        CGContextTranslateCTM(context, turned.width, turned.height);
        CGContextRotateCTM(context, M_PI);
        break;
      case 270:
        CGContextTranslateCTM(context, 0, turned.height);
        CGContextRotateCTM(context, -M_PI_2);
        break;
      default:
        break;
    }
    [photo drawInRect:CGRectMake(0, 0, uprightSize.width, uprightSize.height)];
  }];
  if (result.CGImage == NULL) {
    return [self failWith:@"Cannot straighten the photo" error:error];
  }
  NSDictionary *writeOptions = @{(id)kCGImageDestinationLossyCompressionQuality : @(DocumentKitEditedPhotoQuality)};
  return [self writeImage:result.CGImage to:outputURL options:writeOptions error:error];
}

@end
