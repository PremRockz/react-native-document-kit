#import "DocumentKitDownloader.h"

#import <atomic>

#import <React/RCTInvalidating.h>
#import <React/RCTUtils.h>
#import <UIKit/UIKit.h>

#import "DocumentKitDownloadCache.h"
#import "DocumentKitFileUtils.h"
#import "DocumentKitPresenter.h"

static NSString *const DocumentKitErrorCancelled = @"E_CANCELLED";
static NSString *const DocumentKitErrorHttp = @"E_HTTP";
static NSString *const DocumentKitErrorNetwork = @"E_NETWORK";
static NSString *const DocumentKitErrorStorage = @"E_STORAGE";
static NSString *const DocumentKitErrorBusy = @"E_BUSY";
static NSString *const DocumentKitErrorNoPresenter = @"E_NO_ACTIVITY";

static const NSInteger DocumentKitMaxAttempts = 4;
static const NSTimeInterval DocumentKitRetryBaseDelay = 1.0;
// Applies between packets, so a slow but moving download never times out.
static const NSTimeInterval DocumentKitIdleTimeout = 60;
static const NSTimeInterval DocumentKitProgressInterval = 0.25;

/// Network failures worth another attempt; anything else (cancelled, bad URL, TLS) fails at once.
static BOOL DocumentKitIsTransientError(NSError *_Nullable error)
{
  if (![error.domain isEqualToString:NSURLErrorDomain]) {
    return NO;
  }
  switch (error.code) {
    case NSURLErrorTimedOut:
    case NSURLErrorCannotFindHost:
    case NSURLErrorCannotConnectToHost:
    case NSURLErrorNetworkConnectionLost:
    case NSURLErrorDNSLookupFailed:
    case NSURLErrorNotConnectedToInternet:
    case NSURLErrorInternationalRoamingOff:
    case NSURLErrorCallIsActive:
    case NSURLErrorDataNotAllowed:
      return YES;
    default:
      return NO;
  }
}

/// State of one download. Only touched on the module's serial delegate queue.
@interface DocumentKitDownload : NSObject
@property (nonatomic, copy) NSString *downloadId;
@property (nonatomic, strong) NSURLRequest *request;
@property (nonatomic, strong) DocumentKitDownloadCacheEntry *entry;
@property (nonatomic, copy) RCTPromiseResolveBlock resolve;
@property (nonatomic, copy) RCTPromiseRejectBlock reject;
@property (nonatomic, strong, nullable) NSURLSessionDataTask *task;
@property (nonatomic, strong, nullable) NSFileHandle *fileHandle;
@property (nonatomic) long long bytesWritten;
@property (nonatomic) long long totalBytes;
@property (nonatomic) NSInteger attempt;
/// Non-zero when the server answered with a status that cannot be written to the file.
@property (nonatomic) NSInteger failedStatus;
/// The partial file no longer matches the server's file; the next attempt starts over.
@property (nonatomic) BOOL shouldRestart;
@property (nonatomic, strong, nullable) NSError *storageError;
@property (nonatomic) BOOL isCancelled;
@property (nonatomic) CFAbsoluteTime lastProgressAt;
@end

@implementation DocumentKitDownload
@end

@interface DocumentKitDownloader () <NSURLSessionDataDelegate, UIDocumentPickerDelegate, RCTInvalidating>
@end

@implementation DocumentKitDownloader {
  NSURLSession *_session;
  NSOperationQueue *_delegateQueue;
  NSMutableDictionary<NSString *, DocumentKitDownload *> *_downloadsById;
  NSMutableDictionary<NSNumber *, DocumentKitDownload *> *_downloadsByTask;
  RCTPromiseResolveBlock _pendingSaveResolve;
  NSURL *_pendingSaveDirectory;
  /// Set on reload: the session is gone, so nothing may retry or settle a promise.
  std::atomic<bool> _isInvalidated;
}

RCT_EXPORT_MODULE()

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (instancetype)init
{
  if ((self = [super init])) {
    _delegateQueue = [NSOperationQueue new];
    _delegateQueue.maxConcurrentOperationCount = 1;
    _downloadsById = [NSMutableDictionary dictionary];
    _downloadsByTask = [NSMutableDictionary dictionary];

    NSURLSessionConfiguration *configuration = NSURLSessionConfiguration.defaultSessionConfiguration;
    configuration.timeoutIntervalForRequest = DocumentKitIdleTimeout;
    configuration.timeoutIntervalForResource = 24 * 60 * 60;
    configuration.HTTPMaximumConnectionsPerHost = 3;
    _session = [NSURLSession sessionWithConfiguration:configuration delegate:self delegateQueue:_delegateQueue];
  }
  return self;
}

- (void)invalidate
{
  _isInvalidated = true;
  // The session keeps a strong reference to its delegate until invalidated.
  [_session invalidateAndCancel];
}

#pragma mark - Spec

- (void)download:(NSString *)downloadId
             url:(NSString *)url
         headers:(NSDictionary *)headers
        cacheKey:(NSString *)cacheKey
        fileName:(NSString *)fileName
    notification:(JS::NativeDocumentKitDownloader::NativeDownloadNotification &)notification
    forceRefresh:(BOOL)forceRefresh
         resolve:(RCTPromiseResolveBlock)resolve
          reject:(RCTPromiseRejectBlock)reject
{
  // Download notifications are Android-only: on iOS the Save to Files sheet and the app's
  // own message confirm a save the user just made.
  NSURL *requestURL = [NSURL URLWithString:url];
  if (requestURL == nil) {
    reject(DocumentKitErrorNetwork, @"Invalid download URL", nil);
    return;
  }
  NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:requestURL];
  [headers enumerateKeysAndObjectsUsingBlock:^(id name, id value, BOOL *stop) {
    if ([name isKindOfClass:NSString.class] && [value isKindOfClass:NSString.class]) {
      [request setValue:value forHTTPHeaderField:name];
    }
  }];

  [_delegateQueue addOperationWithBlock:^{
    if (self->_isInvalidated) {
      return;
    }
    NSError *error = nil;
    DocumentKitDownloadCacheEntry *entry = [DocumentKitDownloadCache entryForKey:cacheKey fileName:fileName error:&error];
    if (entry == nil) {
      reject(DocumentKitErrorStorage, @"Could not create the download cache folder", error);
      return;
    }
    if (forceRefresh) {
      // Fresh from the server: the old copy (and a partial of it) must not be reused or resumed.
      NSArray<NSURL *> *files = [NSFileManager.defaultManager contentsOfDirectoryAtURL:entry.directoryURL
                                                            includingPropertiesForKeys:nil
                                                                               options:0
                                                                                 error:nil];
      for (NSURL *file in files) {
        [NSFileManager.defaultManager removeItemAtURL:file error:nil];
      }
    }
    NSURL *cachedURL = forceRefresh ? nil : [entry completedFileURL];
    if (cachedURL != nil) {
      [entry markUsed];
      resolve([self describeFileAtURL:cachedURL fromCache:YES]);
      return;
    }

    DocumentKitDownload *download = [DocumentKitDownload new];
    download.downloadId = downloadId;
    download.request = request;
    download.entry = entry;
    download.resolve = resolve;
    download.reject = reject;
    download.attempt = 1;
    self->_downloadsById[downloadId] = download;
    [self startTransfer:download];
  }];
}

- (void)cancelDownload:(NSString *)downloadId
{
  [_delegateQueue addOperationWithBlock:^{
    DocumentKitDownload *download = self->_downloadsById[downloadId];
    download.isCancelled = YES;
    // Without a task the download is waiting to retry; the retry sees the flag.
    [download.task cancel];
  }];
}

- (void)saveToDevice:(NSString *)fileUri
            fileName:(NSString *)fileName
            mimeType:(NSString *)mimeType
        subdirectory:(NSString *)subdirectory
        notification:(JS::NativeDocumentKitDownloader::NativeDownloadNotification &)notification
             resolve:(RCTPromiseResolveBlock)resolve
              reject:(RCTPromiseRejectBlock)reject
{
  dispatch_async(dispatch_get_main_queue(), ^{
    NSURL *fileURL = [NSURL URLWithString:fileUri];
    if (fileURL == nil || !fileURL.isFileURL) {
      reject(DocumentKitErrorStorage, @"Only local files can be saved", nil);
      return;
    }
    if (self->_pendingSaveResolve != nil) {
      reject(DocumentKitErrorBusy, @"A save is already in progress", nil);
      return;
    }
    // The sheet saves under the file's own name, so export a copy named for the user.
    NSError *error = nil;
    NSURL *exportURL = [self exportCopyOf:fileURL named:fileName error:&error];
    if (exportURL == nil) {
      reject(DocumentKitErrorStorage, @"Could not prepare the file to save", error);
      return;
    }
    // Save to Files: the user chooses the folder; iOS copies the file there.
    UIDocumentPickerViewController *picker = [[UIDocumentPickerViewController alloc] initForExportingURLs:@[ exportURL ]
                                                                                                   asCopy:YES];
    picker.delegate = self;
    self->_pendingSaveResolve = resolve;
    self->_pendingSaveDirectory = exportURL.URLByDeletingLastPathComponent;
    [DocumentKitPresenter present:picker
                        onFailure:^{
                          // Cleared, or every later save would fail with E_BUSY.
                          self->_pendingSaveResolve = nil;
                          [NSFileManager.defaultManager removeItemAtURL:self->_pendingSaveDirectory error:nil];
                          self->_pendingSaveDirectory = nil;
                          reject(DocumentKitErrorNoPresenter, @"No view controller to present the save sheet from", nil);
                        }];
  });
}

- (void)clearDownloadCache:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [_delegateQueue addOperationWithBlock:^{
    [DocumentKitDownloadCache clear];
    resolve(nil);
  }];
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeDocumentKitDownloaderSpecJSI>(params);
}

#pragma mark - Transfer

/// One HTTP attempt. Resumes from the partial file when the server supports ranges.
- (void)startTransfer:(DocumentKitDownload *)download
{
  NSNumber *partSize = [NSFileManager.defaultManager attributesOfItemAtPath:download.entry.partURL.path error:nil][NSFileSize];
  long long resumeFrom = partSize.longLongValue;

  NSMutableURLRequest *request = [download.request mutableCopy];
  if (resumeFrom > 0) {
    [request setValue:[NSString stringWithFormat:@"bytes=%lld-", resumeFrom] forHTTPHeaderField:@"Range"];
  }
  download.bytesWritten = resumeFrom;
  download.failedStatus = 0;
  download.shouldRestart = NO;

  NSURLSessionDataTask *task = [_session dataTaskWithRequest:request];
  download.task = task;
  _downloadsByTask[@(task.taskIdentifier)] = download;
  [task resume];
}

- (void)URLSession:(NSURLSession *)session
              dataTask:(NSURLSessionDataTask *)dataTask
    didReceiveResponse:(NSURLResponse *)response
     completionHandler:(void (^)(NSURLSessionResponseDisposition))completionHandler
{
  DocumentKitDownload *download = _downloadsByTask[@(dataTask.taskIdentifier)];
  if (download == nil || download.isCancelled) {
    completionHandler(NSURLSessionResponseCancel);
    return;
  }

  NSInteger status = [response isKindOfClass:NSHTTPURLResponse.class] ? ((NSHTTPURLResponse *)response).statusCode : 200;
  long long resumeFrom = download.bytesWritten;
  BOOL isResuming = NO;
  if (status == 206 && resumeFrom > 0) {
    isResuming = YES;
  } else if (status == 416 && resumeFrom > 0) {
    [NSFileManager.defaultManager removeItemAtURL:download.entry.partURL error:nil];
    download.shouldRestart = YES;
    completionHandler(NSURLSessionResponseCancel);
    return;
  } else if (status < 200 || status >= 300) {
    download.failedStatus = status;
    completionHandler(NSURLSessionResponseCancel);
    return;
  }

  NSURL *partURL = download.entry.partURL;
  if (!isResuming) {
    // The server sent the whole file, so the partial file is replaced.
    [NSFileManager.defaultManager createFileAtPath:partURL.path contents:nil attributes:nil];
    download.bytesWritten = 0;
  }
  NSError *error = nil;
  download.fileHandle = [NSFileHandle fileHandleForWritingToURL:partURL error:&error];
  if (download.fileHandle == nil || ![download.fileHandle seekToEndReturningOffset:nil error:&error]) {
    download.storageError = error ?: [DocumentKitFileUtils errorWithMessage:@"Could not write the download"];
    completionHandler(NSURLSessionResponseCancel);
    return;
  }

  long long expectedLength = response.expectedContentLength;
  download.totalBytes = expectedLength >= 0 ? download.bytesWritten + expectedLength : -1;
  [self emitProgressFor:download force:YES];
  completionHandler(NSURLSessionResponseAllow);
}

- (void)URLSession:(NSURLSession *)session dataTask:(NSURLSessionDataTask *)dataTask didReceiveData:(NSData *)data
{
  DocumentKitDownload *download = _downloadsByTask[@(dataTask.taskIdentifier)];
  if (download == nil) {
    return;
  }
  NSError *error = nil;
  if (![download.fileHandle writeData:data error:&error]) {
    download.storageError = error;
    [dataTask cancel];
    return;
  }
  download.bytesWritten += (long long)data.length;
  [self emitProgressFor:download force:NO];
}

- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task didCompleteWithError:(NSError *)error
{
  NSNumber *taskKey = @(task.taskIdentifier);
  DocumentKitDownload *download = _downloadsByTask[taskKey];
  if (download == nil) {
    return;
  }
  [_downloadsByTask removeObjectForKey:taskKey];
  [download.fileHandle closeAndReturnError:nil];
  download.fileHandle = nil;
  download.task = nil;

  if (_isInvalidated) {
    // invalidateAndCancel ended it; the JS runtime that asked is already gone.
    [_downloadsById removeObjectForKey:download.downloadId];
    return;
  }

  if (download.isCancelled) {
    [self finish:download rejectCode:DocumentKitErrorCancelled message:@"Download cancelled" error:nil];
    return;
  }
  if (download.storageError != nil) {
    [self finish:download rejectCode:DocumentKitErrorStorage message:@"Could not write the download" error:download.storageError];
    return;
  }

  NSInteger status = download.failedStatus;
  if (status == 0 && error == nil && !download.shouldRestart) {
    [self completeDownload:download];
    return;
  }

  BOOL isRetryable = download.shouldRestart ||
      (status != 0 ? (status == 408 || status == 429 || status >= 500) : DocumentKitIsTransientError(error));
  if (isRetryable && download.attempt < DocumentKitMaxAttempts) {
    // Back off 1s, 2s, 4s so a flaky connection has time to recover.
    NSTimeInterval delay = DocumentKitRetryBaseDelay * (double)(1 << (download.attempt - 1));
    download.attempt += 1;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(delay * NSEC_PER_SEC)),
                   dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
                     [self->_delegateQueue addOperationWithBlock:^{
                       if (self->_isInvalidated) {
                         // A task created on an invalidated session throws.
                         [self->_downloadsById removeObjectForKey:download.downloadId];
                       } else if (download.isCancelled) {
                         [self finish:download rejectCode:DocumentKitErrorCancelled message:@"Download cancelled" error:nil];
                       } else {
                         [self startTransfer:download];
                       }
                     }];
                   });
    return;
  }

  if (status != 0) {
    NSError *httpError = [NSError errorWithDomain:@"com.documentkit"
                                             code:status
                                         userInfo:@{@"status" : @(status)}];
    [self finish:download
        rejectCode:DocumentKitErrorHttp
           message:[NSString stringWithFormat:@"The server answered %ld", (long)status]
             error:httpError];
  } else {
    [self finish:download rejectCode:DocumentKitErrorNetwork message:@"The download could not complete" error:error];
  }
}

- (void)completeDownload:(DocumentKitDownload *)download
{
  DocumentKitDownloadCacheEntry *entry = download.entry;
  NSError *error = nil;
  [NSFileManager.defaultManager removeItemAtURL:entry.finalURL error:nil];
  if (![NSFileManager.defaultManager moveItemAtURL:entry.partURL toURL:entry.finalURL error:&error]) {
    [self finish:download rejectCode:DocumentKitErrorStorage message:@"Could not finish the cached file" error:error];
    return;
  }
  [entry markUsed];
  [DocumentKitDownloadCache trimKeeping:entry.directoryURL];
  [self emitProgressFor:download force:YES];
  [_downloadsById removeObjectForKey:download.downloadId];
  download.resolve([self describeFileAtURL:entry.finalURL fromCache:NO]);
}

- (void)finish:(DocumentKitDownload *)download
    rejectCode:(NSString *)code
       message:(NSString *)message
         error:(nullable NSError *)error
{
  [_downloadsById removeObjectForKey:download.downloadId];
  download.reject(code, message, error);
}

- (void)emitProgressFor:(DocumentKitDownload *)download force:(BOOL)force
{
  CFAbsoluteTime now = CFAbsoluteTimeGetCurrent();
  if (!force && now - download.lastProgressAt < DocumentKitProgressInterval) {
    return;
  }
  download.lastProgressAt = now;
  [self emitOnDownloadProgress:@{
    @"downloadId" : download.downloadId,
    @"bytesWritten" : @(download.bytesWritten),
    @"totalBytes" : @(download.totalBytes),
  }];
}

- (NSDictionary *)describeFileAtURL:(NSURL *)fileURL fromCache:(BOOL)fromCache
{
  NSMutableDictionary *file = [[DocumentKitFileUtils describeFileAtURL:fileURL] mutableCopy];
  file[@"fromCache"] = @(fromCache);
  return file;
}

#pragma mark - UIDocumentPickerDelegate (Save to Files)

- (void)documentPicker:(UIDocumentPickerViewController *)controller didPickDocumentsAtURLs:(NSArray<NSURL *> *)urls
{
  [self resolvePendingSave:@{@"saved" : @YES, @"location" : urls.firstObject.absoluteString ?: @""}];
}

- (void)documentPickerWasCancelled:(UIDocumentPickerViewController *)controller
{
  [self resolvePendingSave:@{@"saved" : @NO}];
}

- (void)resolvePendingSave:(NSDictionary *)result
{
  RCTPromiseResolveBlock resolve = _pendingSaveResolve;
  _pendingSaveResolve = nil;
  if (_pendingSaveDirectory != nil) {
    [NSFileManager.defaultManager removeItemAtURL:_pendingSaveDirectory error:nil];
    _pendingSaveDirectory = nil;
  }
  if (resolve != nil) {
    resolve(result);
  }
}

/// tmp/document-kit-save/<uuid>/<fileName>, removed once the sheet closes.
- (nullable NSURL *)exportCopyOf:(NSURL *)fileURL named:(NSString *)fileName error:(NSError **)error
{
  NSString *safeName = [[fileName componentsSeparatedByCharactersInSet:[NSCharacterSet characterSetWithCharactersInString:@"/\\:"]]
      componentsJoinedByString:@"_"];
  if (safeName.length == 0) {
    safeName = fileURL.lastPathComponent;
  }
  NSURL *directory = [[NSURL fileURLWithPath:NSTemporaryDirectory()]
      URLByAppendingPathComponent:[@"document-kit-save" stringByAppendingPathComponent:NSUUID.UUID.UUIDString]
                      isDirectory:YES];
  if (![NSFileManager.defaultManager createDirectoryAtURL:directory withIntermediateDirectories:YES attributes:nil error:error]) {
    return nil;
  }
  NSURL *exportURL = [directory URLByAppendingPathComponent:safeName];
  return [NSFileManager.defaultManager copyItemAtURL:fileURL toURL:exportURL error:error] ? exportURL : nil;
}

@end
