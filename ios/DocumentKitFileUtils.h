#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Files DocumentKit hands back live under Caches/document-kit, so they survive until iOS clears caches.
@interface DocumentKitFileUtils : NSObject

/// Caches/document-kit
+ (nullable NSURL *)rootDirectoryWithError:(NSError **)error;
/// Caches/document-kit/<uuid>, so a picked file can keep its original name without collisions.
+ (nullable NSURL *)uniqueDirectoryWithError:(NSError **)error;
+ (NSString *)timestampedName:(NSString *)prefix extension:(NSString *)extension;

/// Re-encodes a HEIC/HEIF (or any ImageIO-readable) image as JPEG next to the source.
+ (nullable NSURL *)convertImageToJPEG:(NSURL *)sourceURL error:(NSError **)error;
/// Re-wraps a video as MP4 without re-encoding. Blocks the calling (background) queue.
+ (nullable NSURL *)exportVideoToMP4:(NSURL *)sourceURL
                         destination:(NSURL *)destinationURL
                               error:(NSError **)error;

/// The NativePickedFile shape: uri, name, mimeType, size, width?, height?, durationMs?
+ (NSDictionary *)describeFileAtURL:(NSURL *)url;

+ (NSError *)errorWithMessage:(NSString *)message;

@end

NS_ASSUME_NONNULL_END
