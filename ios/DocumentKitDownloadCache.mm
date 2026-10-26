#import "DocumentKitDownloadCache.h"

#import <CommonCrypto/CommonDigest.h>

static NSString *const DocumentKitPartSuffix = @".part";
// Least recently used entries are removed once the cache grows past this.
static const unsigned long long DocumentKitMaxCacheBytes = 200ULL * 1024 * 1024;

static NSURL *DocumentKitDownloadsRoot(void)
{
  NSURL *caches = [NSFileManager.defaultManager URLsForDirectory:NSCachesDirectory inDomains:NSUserDomainMask].firstObject;
  return [caches URLByAppendingPathComponent:@"document-kit/downloads" isDirectory:YES];
}

static NSString *DocumentKitHash(NSString *value)
{
  NSData *data = [value dataUsingEncoding:NSUTF8StringEncoding];
  unsigned char digest[CC_SHA256_DIGEST_LENGTH];
  CC_SHA256(data.bytes, (CC_LONG)data.length, digest);
  NSMutableString *hex = [NSMutableString stringWithCapacity:32];
  for (int index = 0; index < 16; index++) {
    [hex appendFormat:@"%02x", digest[index]];
  }
  return hex;
}

/// Cache names are internal; viewers use the path directly, so no spaces or path characters.
static NSString *DocumentKitSanitizedFileName(NSString *fileName)
{
  NSMutableCharacterSet *invalid = [NSMutableCharacterSet characterSetWithCharactersInString:@"/\\:*?\"<>|"];
  [invalid formUnionWithCharacterSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
  NSString *trimmed = [fileName stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
  NSString *cleaned = [[trimmed componentsSeparatedByCharactersInSet:invalid] componentsJoinedByString:@"_"];
  if (cleaned.length > 0) {
    return cleaned;
  }
  return [NSString stringWithFormat:@"File_%lld", (long long)(NSDate.date.timeIntervalSince1970 * 1000)];
}

static unsigned long long DocumentKitDirectorySize(NSURL *directoryURL)
{
  unsigned long long total = 0;
  NSArray<NSURL *> *files = [NSFileManager.defaultManager contentsOfDirectoryAtURL:directoryURL
                                                        includingPropertiesForKeys:@[ NSURLFileSizeKey ]
                                                                           options:0
                                                                             error:nil];
  for (NSURL *file in files) {
    NSNumber *size = nil;
    [file getResourceValue:&size forKey:NSURLFileSizeKey error:nil];
    total += size.unsignedLongLongValue;
  }
  return total;
}

@implementation DocumentKitDownloadCacheEntry

- (instancetype)initWithDirectory:(NSURL *)directoryURL fileName:(NSString *)fileName
{
  if ((self = [super init])) {
    _directoryURL = directoryURL;
    _finalURL = [directoryURL URLByAppendingPathComponent:fileName];
    _partURL = [directoryURL URLByAppendingPathComponent:[fileName stringByAppendingString:DocumentKitPartSuffix]];
  }
  return self;
}

- (nullable NSURL *)completedFileURL
{
  if ([NSFileManager.defaultManager fileExistsAtPath:self.finalURL.path]) {
    return self.finalURL;
  }
  NSArray<NSURL *> *files = [NSFileManager.defaultManager contentsOfDirectoryAtURL:self.directoryURL
                                                        includingPropertiesForKeys:nil
                                                                           options:NSDirectoryEnumerationSkipsHiddenFiles
                                                                             error:nil];
  for (NSURL *file in files) {
    if (![file.lastPathComponent hasSuffix:DocumentKitPartSuffix]) {
      return file;
    }
  }
  return nil;
}

- (void)markUsed
{
  [NSFileManager.defaultManager setAttributes:@{NSFileModificationDate : NSDate.date}
                                 ofItemAtPath:self.directoryURL.path
                                        error:nil];
}

@end

@implementation DocumentKitDownloadCache

+ (nullable DocumentKitDownloadCacheEntry *)entryForKey:(NSString *)cacheKey
                                           fileName:(NSString *)fileName
                                              error:(NSError **)error
{
  NSURL *directory = [DocumentKitDownloadsRoot() URLByAppendingPathComponent:DocumentKitHash(cacheKey) isDirectory:YES];
  BOOL created = [NSFileManager.defaultManager createDirectoryAtURL:directory
                                        withIntermediateDirectories:YES
                                                         attributes:nil
                                                              error:error];
  if (!created) {
    return nil;
  }
  return [[DocumentKitDownloadCacheEntry alloc] initWithDirectory:directory fileName:DocumentKitSanitizedFileName(fileName)];
}

+ (void)trimKeeping:(NSURL *)keepURL
{
  NSArray<NSURL *> *entries = [NSFileManager.defaultManager contentsOfDirectoryAtURL:DocumentKitDownloadsRoot()
                                                          includingPropertiesForKeys:@[ NSURLContentModificationDateKey ]
                                                                             options:NSDirectoryEnumerationSkipsHiddenFiles
                                                                               error:nil];
  unsigned long long totalBytes = 0;
  for (NSURL *entry in entries) {
    totalBytes += DocumentKitDirectorySize(entry);
  }

  NSArray<NSURL *> *oldestFirst = [entries sortedArrayUsingComparator:^NSComparisonResult(NSURL *first, NSURL *second) {
    NSDate *firstDate = nil;
    NSDate *secondDate = nil;
    [first getResourceValue:&firstDate forKey:NSURLContentModificationDateKey error:nil];
    [second getResourceValue:&secondDate forKey:NSURLContentModificationDateKey error:nil];
    return [(firstDate ?: NSDate.distantPast) compare:(secondDate ?: NSDate.distantPast)];
  }];

  for (NSURL *entry in oldestFirst) {
    if (totalBytes <= DocumentKitMaxCacheBytes) {
      return;
    }
    if ([entry.standardizedURL isEqual:keepURL.standardizedURL]) {
      continue;
    }
    totalBytes -= DocumentKitDirectorySize(entry);
    [NSFileManager.defaultManager removeItemAtURL:entry error:nil];
  }
}

+ (void)clear
{
  [NSFileManager.defaultManager removeItemAtURL:DocumentKitDownloadsRoot() error:nil];
}

@end
