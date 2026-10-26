#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Caches/document-kit/downloads/<hash of cacheKey>/<file name>
///
/// One folder per cache key keeps the original file name, so a cached file can be
/// saved or shared under its real name. A ".part" file holds an unfinished
/// download so the next attempt can resume it.
@interface DocumentKitDownloadCacheEntry : NSObject
@property (nonatomic, readonly) NSURL *directoryURL;
@property (nonatomic, readonly) NSURL *finalURL;
@property (nonatomic, readonly) NSURL *partURL;
/// Any finished file in the folder; a different name only means an earlier caller named it differently.
- (nullable NSURL *)completedFileURL;
- (void)markUsed;
@end

@interface DocumentKitDownloadCache : NSObject
+ (nullable DocumentKitDownloadCacheEntry *)entryForKey:(NSString *)cacheKey
                                           fileName:(NSString *)fileName
                                              error:(NSError **)error;
/// Removes the least recently used entries until the cache fits, never touching keepURL.
+ (void)trimKeeping:(NSURL *)keepURL;
+ (void)clear;
@end

NS_ASSUME_NONNULL_END
