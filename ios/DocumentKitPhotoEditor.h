#import <CoreGraphics/CoreGraphics.h>
#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * Photo files for DocumentKit's camera: JPEG writing, the screen-sized display
 * copy, and the review screen's rotate and crop on the full-resolution photo.
 * Any queue except where noted; never the main thread for full photos.
 */
@interface DocumentKitPhotoEditor : NSObject

/// Writes a JPEG into Caches/document-kit.
+ (nullable NSURL *)writeJPEG:(CGImageRef)image prefix:(NSString *)prefix error:(NSError **)error;

/// A copy no larger than `maxPixels` on its long edge, upright, so the review never decodes a 12–48 MP photo.
+ (nullable NSURL *)writeDisplayCopyOfPhoto:(NSURL *)photoURL maxPixels:(CGFloat)maxPixels error:(NSError **)error;

/**
 * An edited copy of `photoURL`, applied in this order: turned `rotationDegrees`
 * clockwise (0/90/180/270), mirrored left to right when `isFlipped`, turned
 * `straightenDegrees` more (zoomed in so no corner is empty), then cropped to
 * `crop`, fractions (0–1) of the result. Rotation and flip alone only rewrite
 * the orientation metadata; straightening redraws the pixels. The original is
 * kept. Returns the NativeCapturedPhoto dictionary.
 */
+ (nullable NSDictionary *)editPhoto:(NSURL *)photoURL
                            rotation:(NSInteger)rotationDegrees
                           isFlipped:(BOOL)isFlipped
                          straighten:(CGFloat)straightenDegrees
                                crop:(CGRect)crop
                    maxDisplayPixels:(CGFloat)maxDisplayPixels
                               error:(NSError **)error;

@end

NS_ASSUME_NONNULL_END
