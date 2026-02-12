#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <React/RCTLog.h>
#import <BackgroundTasks/BackgroundTasks.h>
#import <UserNotifications/UserNotifications.h>

@interface BackgroundTaskModule : RCTEventEmitter <RCTBridgeModule>
@property (nonatomic, strong) NSURLSession *backgroundSession;
@property (nonatomic, strong) NSTimer *backgroundTimer;
@property (nonatomic, assign) UIBackgroundTaskIdentifier backgroundTask;
@property (nonatomic, strong) NSMutableDictionary *pendingTasks;
@property (nonatomic, assign) BOOL isBackgroundFetchRegistered;
@property (nonatomic, assign) BOOL isProcessingTaskRegistered;
@end

@implementation BackgroundTaskModule

RCT_EXPORT_MODULE(BackgroundTaskModule);

// Override to specify that this module needs to be initialized on the main queue
+ (BOOL)requiresMainQueueSetup {
    return YES;
}

// Supported events
- (NSArray<NSString *> *)supportedEvents {
    return @[
        @"onBackgroundFetch",
        @"onBackgroundProcessing",
        @"onBackgroundTaskExpiring",
        @"onBackgroundTaskCompleted",
        @"onBackgroundURLSessionEvent"
    ];
}

// Initialize the module
- (instancetype)init {
    if (self = [super init]) {
        _pendingTasks = [NSMutableDictionary new];
        _backgroundTask = UIBackgroundTaskInvalid;
        _isBackgroundFetchRegistered = NO;
        _isProcessingTaskRegistered = NO;

        // Configure background URL session
        [self configureBackgroundURLSession];

        // Register for app lifecycle notifications
        [self registerForAppLifecycleNotifications];

        RCTLogInfo(@"BackgroundTaskModule: Initialized");
    }
    return self;
}

// Configure background URL session for network requests in background
- (void)configureBackgroundURLSession {
    NSURLSessionConfiguration *configuration = [NSURLSessionConfiguration backgroundSessionConfigurationWithIdentifier:@"com.netguard.background"];
    configuration.allowsCellularAccess = YES;
    configuration.sessionSendsLaunchEvents = YES;
    configuration.discretionary = NO; // Don't wait for optimal conditions
    configuration.shouldUseExtendedBackgroundIdleMode = YES;

    // Configure timeout intervals
    configuration.timeoutIntervalForRequest = 30.0;
    configuration.timeoutIntervalForResource = 300.0;

    // Create session
    self.backgroundSession = [NSURLSession sessionWithConfiguration:configuration
                                                           delegate:nil
                                                      delegateQueue:nil];

    RCTLogInfo(@"BackgroundTaskModule: Background URL session configured");
}

// Register for app lifecycle notifications
- (void)registerForAppLifecycleNotifications {
    [[NSNotificationCenter defaultCenter] addObserver:self
                                             selector:@selector(appDidEnterBackground:)
                                                 name:UIApplicationDidEnterBackgroundNotification
                                               object:nil];

    [[NSNotificationCenter defaultCenter] addObserver:self
                                             selector:@selector(appWillEnterForeground:)
                                                 name:UIApplicationWillEnterForegroundNotification
                                               object:nil];

    [[NSNotificationCenter defaultCenter] addObserver:self
                                             selector:@selector(appWillTerminate:)
                                                 name:UIApplicationWillTerminateNotification
                                               object:nil];
}

#pragma mark - React Native Methods

// Register for background fetch
RCT_EXPORT_METHOD(registerBackgroundFetch:(double)minimumInterval
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {

    dispatch_async(dispatch_get_main_queue(), ^{
        @try {
            UIApplication *application = [UIApplication sharedApplication];

            // Set minimum background fetch interval
            NSTimeInterval interval = minimumInterval * 60; // Convert minutes to seconds
            if (interval < UIApplicationBackgroundFetchIntervalMinimum) {
                interval = UIApplicationBackgroundFetchIntervalMinimum;
            }

            [application setMinimumBackgroundFetchInterval:interval];

            self.isBackgroundFetchRegistered = YES;

            RCTLogInfo(@"BackgroundTaskModule: Background fetch registered with interval: %f seconds", interval);
            resolve(@{
                @"success": @YES,
                @"interval": @(interval),
                @"message": @"Background fetch registered successfully"
            });

        } @catch (NSException *exception) {
            RCTLogError(@"BackgroundTaskModule: Failed to register background fetch: %@", exception);
            reject(@"REGISTRATION_FAILED", @"Failed to register background fetch", nil);
        }
    });
}

// Unregister background fetch
RCT_EXPORT_METHOD(unregisterBackgroundFetch:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {

    dispatch_async(dispatch_get_main_queue(), ^{
        UIApplication *application = [UIApplication sharedApplication];
        [application setMinimumBackgroundFetchInterval:UIApplicationBackgroundFetchIntervalNever];

        self.isBackgroundFetchRegistered = NO;

        RCTLogInfo(@"BackgroundTaskModule: Background fetch unregistered");
        resolve(@{@"success": @YES});
    });
}

// Register background processing task (iOS 13+)
RCT_EXPORT_METHOD(registerBackgroundProcessingTask:(NSString *)taskIdentifier
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {

    if (@available(iOS 13.0, *)) {
        @try {
            BGTaskScheduler *scheduler = [BGTaskScheduler sharedScheduler];

            // Register the task
            BOOL registered = [scheduler registerForTaskWithIdentifier:taskIdentifier
                                                          usingQueue:nil
                                                       launchHandler:^(BGTask * _Nonnull task) {
                [self handleBackgroundTask:task];
            }];

            if (registered) {
                self.isProcessingTaskRegistered = YES;
                RCTLogInfo(@"BackgroundTaskModule: Background processing task registered: %@", taskIdentifier);
                resolve(@{
                    @"success": @YES,
                    @"taskIdentifier": taskIdentifier
                });
            } else {
                reject(@"REGISTRATION_FAILED", @"Failed to register background processing task", nil);
            }

        } @catch (NSException *exception) {
            RCTLogError(@"BackgroundTaskModule: Failed to register background task: %@", exception);
            reject(@"REGISTRATION_FAILED", exception.reason, nil);
        }
    } else {
        reject(@"UNSUPPORTED", @"Background processing tasks require iOS 13+", nil);
    }
}

// Schedule a background processing task
RCT_EXPORT_METHOD(scheduleBackgroundProcessingTask:(NSString *)taskIdentifier
                  earliestBeginDate:(double)delayInSeconds
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {

    if (@available(iOS 13.0, *)) {
        @try {
            BGProcessingTaskRequest *request = [[BGProcessingTaskRequest alloc] initWithIdentifier:taskIdentifier];
            request.requiresNetworkConnectivity = YES;
            request.requiresExternalPower = NO;

            if (delayInSeconds > 0) {
                request.earliestBeginDate = [NSDate dateWithTimeIntervalSinceNow:delayInSeconds];
            }

            BGTaskScheduler *scheduler = [BGTaskScheduler sharedScheduler];
            NSError *error = nil;
            BOOL submitted = [scheduler submitTaskRequest:request error:&error];

            if (submitted) {
                RCTLogInfo(@"BackgroundTaskModule: Background task scheduled: %@", taskIdentifier);
                resolve(@{
                    @"success": @YES,
                    @"taskIdentifier": taskIdentifier,
                    @"scheduledDate": @([[NSDate date] timeIntervalSince1970] * 1000)
                });
            } else {
                RCTLogError(@"BackgroundTaskModule: Failed to schedule task: %@", error);
                reject(@"SCHEDULING_FAILED", error.localizedDescription, error);
            }

        } @catch (NSException *exception) {
            reject(@"SCHEDULING_FAILED", exception.reason, nil);
        }
    } else {
        reject(@"UNSUPPORTED", @"Background processing tasks require iOS 13+", nil);
    }
}

// Schedule a background app refresh task (iOS 13+)
RCT_EXPORT_METHOD(scheduleBackgroundAppRefresh:(NSString *)taskIdentifier
                  earliestBeginDate:(double)delayInSeconds
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {

    if (@available(iOS 13.0, *)) {
        @try {
            BGAppRefreshTaskRequest *request = [[BGAppRefreshTaskRequest alloc] initWithIdentifier:taskIdentifier];

            if (delayInSeconds > 0) {
                request.earliestBeginDate = [NSDate dateWithTimeIntervalSinceNow:delayInSeconds];
            }

            BGTaskScheduler *scheduler = [BGTaskScheduler sharedScheduler];
            NSError *error = nil;
            BOOL submitted = [scheduler submitTaskRequest:request error:&error];

            if (submitted) {
                RCTLogInfo(@"BackgroundTaskModule: App refresh task scheduled: %@", taskIdentifier);
                resolve(@{
                    @"success": @YES,
                    @"taskIdentifier": taskIdentifier,
                    @"type": @"appRefresh"
                });
            } else {
                RCTLogError(@"BackgroundTaskModule: Failed to schedule app refresh: %@", error);
                reject(@"SCHEDULING_FAILED", error.localizedDescription, error);
            }

        } @catch (NSException *exception) {
            reject(@"SCHEDULING_FAILED", exception.reason, nil);
        }
    } else {
        reject(@"UNSUPPORTED", @"Background app refresh requires iOS 13+", nil);
    }
}

// Start a background task (for finite-length tasks)
RCT_EXPORT_METHOD(startBackgroundTask:(NSString *)taskName
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {

    dispatch_async(dispatch_get_main_queue(), ^{
        if (self.backgroundTask != UIBackgroundTaskInvalid) {
            RCTLogWarn(@"BackgroundTaskModule: Background task already running");
            reject(@"TASK_ALREADY_RUNNING", @"A background task is already running", nil);
            return;
        }

        UIApplication *application = [UIApplication sharedApplication];

        __weak typeof(self) weakSelf = self;
        self.backgroundTask = [application beginBackgroundTaskWithName:taskName
                                                      expirationHandler:^{
            __strong typeof(weakSelf) strongSelf = weakSelf;
            [strongSelf handleBackgroundTaskExpiration];
        }];

        if (self.backgroundTask == UIBackgroundTaskInvalid) {
            reject(@"TASK_FAILED", @"Failed to start background task", nil);
        } else {
            // Store task info
            self.pendingTasks[taskName] = @{
                @"taskId": @(self.backgroundTask),
                @"startTime": @([[NSDate date] timeIntervalSince1970] * 1000),
                @"name": taskName
            };

            RCTLogInfo(@"BackgroundTaskModule: Background task started: %@ (ID: %lu)",
                      taskName, (unsigned long)self.backgroundTask);

            resolve(@{
                @"success": @YES,
                @"taskId": @(self.backgroundTask),
                @"remainingTime": @([application backgroundTimeRemaining]),
                @"taskName": taskName
            });
        }
    });
}

// End a background task
RCT_EXPORT_METHOD(endBackgroundTask:(NSString *)taskName
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {

    dispatch_async(dispatch_get_main_queue(), ^{
        if (self.backgroundTask == UIBackgroundTaskInvalid) {
            RCTLogWarn(@"BackgroundTaskModule: No background task to end");
            resolve(@{@"success": @NO, @"message": @"No background task running"});
            return;
        }

        UIApplication *application = [UIApplication sharedApplication];
        UIBackgroundTaskIdentifier taskToEnd = self.backgroundTask;
        self.backgroundTask = UIBackgroundTaskInvalid;

        [application endBackgroundTask:taskToEnd];

        // Remove from pending tasks
        [self.pendingTasks removeObjectForKey:taskName];

        RCTLogInfo(@"BackgroundTaskModule: Background task ended: %@", taskName);

        [self sendEventWithName:@"onBackgroundTaskCompleted"
                           body:@{
                               @"taskName": taskName,
                               @"timestamp": @([[NSDate date] timeIntervalSince1970] * 1000)
                           }];

        resolve(@{
            @"success": @YES,
            @"taskName": taskName
        });
    });
}

// Get remaining background time
RCT_EXPORT_METHOD(getRemainingBackgroundTime:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {

    dispatch_async(dispatch_get_main_queue(), ^{
        UIApplication *application = [UIApplication sharedApplication];
        NSTimeInterval remainingTime = [application backgroundTimeRemaining];

        resolve(@{
            @"remainingTime": @(remainingTime),
            @"isInfinite": @(remainingTime == DBL_MAX),
            @"taskRunning": @(self.backgroundTask != UIBackgroundTaskInvalid)
        });
    });
}

// Cancel all scheduled background tasks (iOS 13+)
RCT_EXPORT_METHOD(cancelAllBackgroundTasks:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {

    if (@available(iOS 13.0, *)) {
        BGTaskScheduler *scheduler = [BGTaskScheduler sharedScheduler];
        [scheduler cancelAllTaskRequests];

        RCTLogInfo(@"BackgroundTaskModule: All background tasks cancelled");
        resolve(@{@"success": @YES});
    } else {
        resolve(@{@"success": @NO, @"message": @"Requires iOS 13+"});
    }
}

// Cancel specific background task (iOS 13+)
RCT_EXPORT_METHOD(cancelBackgroundTask:(NSString *)taskIdentifier
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {

    if (@available(iOS 13.0, *)) {
        BGTaskScheduler *scheduler = [BGTaskScheduler sharedScheduler];
        [scheduler cancelTaskRequestWithIdentifier:taskIdentifier];

        RCTLogInfo(@"BackgroundTaskModule: Background task cancelled: %@", taskIdentifier);
        resolve(@{
            @"success": @YES,
            @"taskIdentifier": taskIdentifier
        });
    } else {
        resolve(@{@"success": @NO, @"message": @"Requires iOS 13+"});
    }
}

// Get pending background tasks (iOS 13+)
RCT_EXPORT_METHOD(getPendingBackgroundTasks:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {

    if (@available(iOS 13.0, *)) {
        BGTaskScheduler *scheduler = [BGTaskScheduler sharedScheduler];
        [scheduler getPendingTaskRequestsWithCompletionHandler:^(NSArray<BGTaskRequest *> * _Nonnull taskRequests) {
            NSMutableArray *tasks = [NSMutableArray array];

            for (BGTaskRequest *request in taskRequests) {
                NSMutableDictionary *taskInfo = [NSMutableDictionary dictionary];
                taskInfo[@"identifier"] = request.identifier;
                taskInfo[@"earliestBeginDate"] = @([request.earliestBeginDate timeIntervalSince1970] * 1000);

                if ([request isKindOfClass:[BGProcessingTaskRequest class]]) {
                    BGProcessingTaskRequest *processingRequest = (BGProcessingTaskRequest *)request;
                    taskInfo[@"type"] = @"processing";
                    taskInfo[@"requiresNetworkConnectivity"] = @(processingRequest.requiresNetworkConnectivity);
                    taskInfo[@"requiresExternalPower"] = @(processingRequest.requiresExternalPower);
                } else if ([request isKindOfClass:[BGAppRefreshTaskRequest class]]) {
                    taskInfo[@"type"] = @"appRefresh";
                }

                [tasks addObject:taskInfo];
            }

            resolve(@{
                @"success": @YES,
                @"tasks": tasks,
                @"count": @(tasks.count)
            });
        }];
    } else {
        resolve(@{
            @"success": @NO,
            @"message": @"Requires iOS 13+",
            @"tasks": @[]
        });
    }
}

// Enable/disable battery optimization exemption request
RCT_EXPORT_METHOD(requestBatteryOptimizationExemption:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {

    // iOS doesn't have a direct equivalent to Android's battery optimization exemption
    // But we can guide users to Settings
    dispatch_async(dispatch_get_main_queue(), ^{
        UIApplication *application = [UIApplication sharedApplication];
        NSURL *url = [NSURL URLWithString:UIApplicationOpenSettingsURLString];

        if ([application canOpenURL:url]) {
            [application openURL:url options:@{} completionHandler:^(BOOL success) {
                if (success) {
                    resolve(@{
                        @"success": @YES,
                        @"message": @"Opened settings for battery optimization"
                    });
                } else {
                    reject(@"OPEN_SETTINGS_FAILED", @"Failed to open settings", nil);
                }
            }];
        } else {
            reject(@"CANNOT_OPEN_SETTINGS", @"Cannot open settings", nil);
        }
    });
}

#pragma mark - Background Task Handlers

// Handle background task for iOS 13+
- (void)handleBackgroundTask:(BGTask *)task API_AVAILABLE(ios(13.0)) {
    RCTLogInfo(@"BackgroundTaskModule: Handling background task: %@", task.identifier);

    // Send event to React Native
    [self sendEventWithName:@"onBackgroundProcessing"
                       body:@{
                           @"taskIdentifier": task.identifier,
                           @"timestamp": @([[NSDate date] timeIntervalSince1970] * 1000)
                       }];

    // Set expiration handler
    task.expirationHandler = ^{
        RCTLogWarn(@"BackgroundTaskModule: Background task expired: %@", task.identifier);
        [task setTaskCompletedWithSuccess:NO];

        // Schedule a new task for retry
        [self scheduleRetryForTask:task.identifier];
    };

    // Perform the background work
    dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^{
        // This is where the actual work happens
        // The React Native side should handle the actual URL checking

        // Simulate work completion after a delay
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(10 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
            [task setTaskCompletedWithSuccess:YES];

            // Schedule next task
            [self scheduleNextBackgroundTask:task.identifier];
        });
    });
}

// Handle background task expiration
- (void)handleBackgroundTaskExpiration {
    RCTLogWarn(@"BackgroundTaskModule: Background task is about to expire");

    [self sendEventWithName:@"onBackgroundTaskExpiring"
                       body:@{
                           @"timestamp": @([[NSDate date] timeIntervalSince1970] * 1000),
                           @"pendingTasks": self.pendingTasks
                       }];

    // Clean up
    UIApplication *application = [UIApplication sharedApplication];
    UIBackgroundTaskIdentifier taskToEnd = self.backgroundTask;
    self.backgroundTask = UIBackgroundTaskInvalid;

    [application endBackgroundTask:taskToEnd];
}

// Schedule retry for failed task
- (void)scheduleRetryForTask:(NSString *)taskIdentifier API_AVAILABLE(ios(13.0)) {
    BGProcessingTaskRequest *request = [[BGProcessingTaskRequest alloc] initWithIdentifier:taskIdentifier];
    request.requiresNetworkConnectivity = YES;
    request.requiresExternalPower = NO;
    request.earliestBeginDate = [NSDate dateWithTimeIntervalSinceNow:300]; // Retry in 5 minutes

    BGTaskScheduler *scheduler = [BGTaskScheduler sharedScheduler];
    NSError *error = nil;
    [scheduler submitTaskRequest:request error:&error];

    if (error) {
        RCTLogError(@"BackgroundTaskModule: Failed to schedule retry: %@", error);
    } else {
        RCTLogInfo(@"BackgroundTaskModule: Retry scheduled for task: %@", taskIdentifier);
    }
}

// Schedule next background task
- (void)scheduleNextBackgroundTask:(NSString *)taskIdentifier API_AVAILABLE(ios(13.0)) {
    BGProcessingTaskRequest *request = [[BGProcessingTaskRequest alloc] initWithIdentifier:taskIdentifier];
    request.requiresNetworkConnectivity = YES;
    request.requiresExternalPower = NO;
    request.earliestBeginDate = [NSDate dateWithTimeIntervalSinceNow:900]; // Next check in 15 minutes

    BGTaskScheduler *scheduler = [BGTaskScheduler sharedScheduler];
    NSError *error = nil;
    [scheduler submitTaskRequest:request error:&error];

    if (error) {
        RCTLogError(@"BackgroundTaskModule: Failed to schedule next task: %@", error);
    } else {
        RCTLogInfo(@"BackgroundTaskModule: Next task scheduled: %@", taskIdentifier);
    }
}

#pragma mark - App Lifecycle

- (void)appDidEnterBackground:(NSNotification *)notification {
    RCTLogInfo(@"BackgroundTaskModule: App entered background");

    // Start a background task to keep app running
    if (self.backgroundTask == UIBackgroundTaskInvalid) {
        UIApplication *application = [UIApplication sharedApplication];

        __weak typeof(self) weakSelf = self;
        self.backgroundTask = [application beginBackgroundTaskWithName:@"NetGuardBackgroundTask"
                                                      expirationHandler:^{
            __strong typeof(weakSelf) strongSelf = weakSelf;
            [strongSelf handleBackgroundTaskExpiration];
        }];

        RCTLogInfo(@"BackgroundTaskModule: Started background task with %f seconds remaining",
                  [application backgroundTimeRemaining]);
    }
}

- (void)appWillEnterForeground:(NSNotification *)notification {
    RCTLogInfo(@"BackgroundTaskModule: App will enter foreground");

    // End background task if running
    if (self.backgroundTask != UIBackgroundTaskInvalid) {
        UIApplication *application = [UIApplication sharedApplication];
        UIBackgroundTaskIdentifier taskToEnd = self.backgroundTask;
        self.backgroundTask = UIBackgroundTaskInvalid;
        [application endBackgroundTask:taskToEnd];

        RCTLogInfo(@"BackgroundTaskModule: Ended background task");
    }
}

- (void)appWillTerminate:(NSNotification *)notification {
    RCTLogInfo(@"BackgroundTaskModule: App will terminate");

    // Clean up resources
    [self.backgroundSession invalidateAndCancel];
    self.backgroundSession = nil;

    // Remove observers
    [[NSNotificationCenter defaultCenter] removeObserver:self];
}

- (void)dealloc {
    [[NSNotificationCenter defaultCenter] removeObserver:self];
}

@end
