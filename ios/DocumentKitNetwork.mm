#import "DocumentKitNetwork.h"

#import <CoreTelephony/CTTelephonyNetworkInfo.h>
#import <Network/Network.h>

static NSString *const DocumentKitGenerationUnknown = @"unknown";

/// Maps the radio technology of any active SIM to a generation; the fastest one wins.
static NSString *DocumentKitCellularGeneration(void)
{
  NSDictionary<NSString *, NSString *> *technologies =
      [CTTelephonyNetworkInfo new].serviceCurrentRadioAccessTechnology;
  NSSet<NSString *> *fifth = [NSSet setWithArray:@[ CTRadioAccessTechnologyNRNSA, CTRadioAccessTechnologyNR ]];
  NSSet<NSString *> *third = [NSSet setWithArray:@[
    CTRadioAccessTechnologyWCDMA, CTRadioAccessTechnologyHSDPA, CTRadioAccessTechnologyHSUPA,
    CTRadioAccessTechnologyCDMAEVDORev0, CTRadioAccessTechnologyCDMAEVDORevA,
    CTRadioAccessTechnologyCDMAEVDORevB, CTRadioAccessTechnologyeHRPD,
  ]];
  NSSet<NSString *> *second = [NSSet setWithArray:@[
    CTRadioAccessTechnologyGPRS, CTRadioAccessTechnologyEdge, CTRadioAccessTechnologyCDMA1x,
  ]];

  NSString *generation = DocumentKitGenerationUnknown;
  for (NSString *technology in technologies.allValues) {
    if ([fifth containsObject:technology]) {
      return @"5g";
    }
    if ([technology isEqualToString:CTRadioAccessTechnologyLTE]) {
      generation = @"4g";
    } else if ([third containsObject:technology] && ![generation isEqualToString:@"4g"]) {
      generation = @"3g";
    } else if ([second containsObject:technology] && [generation isEqualToString:DocumentKitGenerationUnknown]) {
      generation = @"2g";
    }
  }
  return generation;
}

static NSString *DocumentKitTransport(nw_path_t path)
{
  if (nw_path_get_status(path) != nw_path_status_satisfied) {
    return @"none";
  }
  if (nw_path_uses_interface_type(path, nw_interface_type_wifi)) {
    return @"wifi";
  }
  if (nw_path_uses_interface_type(path, nw_interface_type_wired)) {
    return @"ethernet";
  }
  if (nw_path_uses_interface_type(path, nw_interface_type_cellular)) {
    return @"cellular";
  }
  return @"other";
}

@implementation DocumentKitNetwork

RCT_EXPORT_MODULE()

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (void)getNetworkSnapshot:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  // A path monitor reports the current path once right after it starts; read it and stop.
  nw_path_monitor_t monitor = nw_path_monitor_create();
  nw_path_monitor_set_queue(monitor, dispatch_queue_create("com.documentkit.network", DISPATCH_QUEUE_SERIAL));
  __block BOOL didResolve = NO;
  nw_path_monitor_set_update_handler(monitor, ^(nw_path_t path) {
    if (didResolve) {
      return;
    }
    didResolve = YES;
    NSString *transport = DocumentKitTransport(path);
    resolve(@{
      @"transport" : transport,
      @"cellularGeneration" : [transport isEqualToString:@"cellular"] ? DocumentKitCellularGeneration() : DocumentKitGenerationUnknown,
      // iOS gives no bandwidth estimate.
      @"upstreamKbps" : @(-1),
      @"isMetered" : @(nw_path_is_expensive(path)),
      @"isDataSaverOn" : @(nw_path_is_constrained(path)),
    });
    nw_path_monitor_cancel(monitor);
  });
  nw_path_monitor_start(monitor);
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeDocumentKitNetworkSpecJSI>(params);
}

@end
