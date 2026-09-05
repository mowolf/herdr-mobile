// HerdrMenuBar - a menu bar switch for the herdr-mobile gateway.
//
// Owns two child processes and keeps them in step:
//   * the gateway itself (server.py), so the phone has something to talk to
//   * `caffeinate -s`, because an asleep Mac cannot send a push notification,
//     which is what made "notify me when an agent finishes" unreliable
//
// It also brings Tailscale up, since the phone reaches the gateway over the
// tailnet and a stopped Tailscale takes the whole thing offline.
//
// One switch drives both, and the bar icon shows the state at a glance.
//
// Written in Objective-C rather than Swift on purpose: this machine's Command
// Line Tools ship a duplicate SwiftBridging modulemap that breaks every Swift
// AppKit build, and clang is unaffected.

#import <AppKit/AppKit.h>
#import <signal.h>

@interface Controller : NSObject <NSApplicationDelegate, NSMenuDelegate>
@property(strong) NSStatusItem *statusItem;
@property(strong) NSTask *server;
@property(strong) NSTask *caffeinate;
@property(copy) NSString *port;
@property(copy) NSString *serverPath;
@property(copy) NSString *tailscalePath;
@property(assign) BOOL tailscaleUp;
@end

@implementation Controller

- (BOOL)isRunning {
    return self.server != nil && self.server.isRunning;
}

#pragma mark - Locating the gateway

/// Resolution order: an explicit default, the environment, then a walk up from
/// the bundle - which finds it when the app is built inside the repo.
- (NSString *)resolveServerPath {
    NSFileManager *fm = NSFileManager.defaultManager;
    NSString *pref = [NSUserDefaults.standardUserDefaults stringForKey:@"serverPath"];
    if (pref.length && [fm isReadableFileAtPath:pref]) return pref;

    NSString *env = NSProcessInfo.processInfo.environment[@"HERDR_SERVER"];
    if (env.length && [fm isReadableFileAtPath:env]) return env;

    NSURL *dir = [NSURL fileURLWithPath:NSBundle.mainBundle.bundlePath];
    for (int i = 0; i < 6; i++) {
        dir = dir.URLByDeletingLastPathComponent;
        NSString *candidate = [dir URLByAppendingPathComponent:@"server.py"].path;
        if ([fm isReadableFileAtPath:candidate]) return candidate;
    }
    NSString *fallback = @"~/repos/herdr-mobile/server.py".stringByExpandingTildeInPath;
    return [fm isReadableFileAtPath:fallback] ? fallback : nil;
}

#pragma mark - Tailscale

/// The CLI lives in /usr/local/bin for the standalone build and inside the
/// bundle for the App Store one.
- (NSString *)resolveTailscalePath {
    NSArray *candidates = @[
        @"/usr/local/bin/tailscale",
        @"/opt/homebrew/bin/tailscale",
        @"/Applications/Tailscale.app/Contents/MacOS/Tailscale",
    ];
    for (NSString *path in candidates) {
        if ([NSFileManager.defaultManager isExecutableFileAtPath:path]) return path;
    }
    return nil;
}

/// `tailscale status` exits non-zero when the tailnet is not connected.
- (BOOL)checkTailscale {
    if (!self.tailscalePath) return NO;
    NSTask *task = [NSTask new];
    task.executableURL = [NSURL fileURLWithPath:self.tailscalePath];
    task.arguments = @[ @"status" ];
    task.standardOutput = NSFileHandle.fileHandleWithNullDevice;
    task.standardError = NSFileHandle.fileHandleWithNullDevice;
    if (![task launchAndReturnError:nil]) return NO;
    [task waitUntilExit];
    return task.terminationStatus == 0;
}

/// Off the main thread: `tailscale up` can block while it reconnects.
- (void)startTailscale {
    if (!self.tailscalePath) return;
    __weak typeof(self) weakSelf = self;
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
        typeof(self) strongSelf = weakSelf;
        if (!strongSelf || [strongSelf checkTailscale]) {
            dispatch_async(dispatch_get_main_queue(), ^{
                weakSelf.tailscaleUp = YES;
                [weakSelf render];
            });
            return;
        }
        NSTask *task = [NSTask new];
        task.executableURL = [NSURL fileURLWithPath:strongSelf.tailscalePath];
        task.arguments = @[ @"up" ];
        task.standardOutput = NSFileHandle.fileHandleWithNullDevice;
        task.standardError = NSFileHandle.fileHandleWithNullDevice;
        if ([task launchAndReturnError:nil]) [task waitUntilExit];
        BOOL up = [strongSelf checkTailscale];
        dispatch_async(dispatch_get_main_queue(), ^{
            weakSelf.tailscaleUp = up;
            [weakSelf render];
        });
    });
}

#pragma mark - Lifecycle

- (void)applicationDidFinishLaunching:(NSNotification *)note {
    NSString *envPort = NSProcessInfo.processInfo.environment[@"HERDR_PORT"];
    self.port = envPort.length ? envPort : @"3009";
    self.serverPath = [self resolveServerPath];
    self.tailscalePath = [self resolveTailscalePath];

    self.statusItem = [NSStatusBar.systemStatusBar statusItemWithLength:NSVariableStatusItemLength];
    [self render];

    // Something else may already hold the port: our own orphaned gateway from
    // a previous run, which we can reclaim, or a launchd copy, which we cannot.
    pid_t holder = [self portHolder];
    if (holder > 0 && [self isOurGateway:holder]) {
        kill(holder, SIGTERM);
        usleep(400000);
    }
    if ([self portHolder] > 0) {
        [self warnPortBusy];
    } else {
        [self start];
    }
}

- (void)applicationWillTerminate:(NSNotification *)note {
    [self stop];
}

#pragma mark - Processes

- (void)start {
    if (!self.serverPath) { [self render]; return; }

    // System python3 is in the macOS firewall's allowlist; a Homebrew one is
    // not, and incoming tailnet connections to it are silently dropped.
    NSTask *py = [NSTask new];
    py.executableURL = [NSURL fileURLWithPath:@"/usr/bin/python3"];
    py.arguments = @[ self.serverPath ];
    NSMutableDictionary *env = [NSProcessInfo.processInfo.environment mutableCopy];
    if (!env[@"HOST"]) env[@"HOST"] = @"127.0.0.1";
    env[@"PORT"] = self.port;
    py.environment = env;
    py.currentDirectoryURL =
        [NSURL fileURLWithPath:self.serverPath].URLByDeletingLastPathComponent;
    __weak typeof(self) weakSelf = self;
    py.terminationHandler = ^(NSTask *t) {
        dispatch_async(dispatch_get_main_queue(), ^{ [weakSelf render]; });
    };
    [py launchAndReturnError:nil];
    self.server = py;

    // -s prevents system sleep but lets the display sleep, so the screen still
    // dims and locks normally. -w ties it to our own pid, so even a crash or
    // SIGKILL releases the assertion instead of holding the Mac awake forever.
    NSTask *caf = [NSTask new];
    caf.executableURL = [NSURL fileURLWithPath:@"/usr/bin/caffeinate"];
    caf.arguments = @[ @"-s", @"-w",
                       [NSString stringWithFormat:@"%d", NSProcessInfo.processInfo.processIdentifier] ];
    [caf launchAndReturnError:nil];
    self.caffeinate = caf;

    // The phone reaches the gateway over the tailnet, so bring it up too.
    [self startTailscale];

    [self render];
}

- (void)stop {
    if (self.server.isRunning) [self.server terminate];
    if (self.caffeinate.isRunning) [self.caffeinate terminate];
    self.server = nil;
    self.caffeinate = nil;
    [self render];
}

- (void)toggle:(id)sender {
    if (self.isRunning) [self stop]; else [self start];
}

#pragma mark - Menu

- (void)render {
    BOOL on = self.isRunning;

    NSString *symbol = on ? @"antenna.radiowaves.left.and.right"
                          : @"antenna.radiowaves.left.and.right.slash";
    NSImage *image = [NSImage imageWithSystemSymbolName:symbol accessibilityDescription:@"herdr-mobile"];
    if (image) {
        image.template = YES;
        self.statusItem.button.image = image;
    } else {
        self.statusItem.button.title = on ? @"H" : @"h";
    }
    self.statusItem.button.appearsDisabled = !on;

    NSMenu *menu = [NSMenu new];
    [menu addItem:[self header:on ? [NSString stringWithFormat:@"Gateway running on :%@", self.port]
                                  : @"Gateway stopped"]];
    [menu addItem:[self header:on ? @"Keeping the Mac awake"
                                  : @"Mac may sleep - no notifications"]];
    if (self.tailscalePath) {
        [menu addItem:[self header:self.tailscaleUp ? @"Tailscale connected"
                                                    : @"Tailscale disconnected"]];
    } else {
        [menu addItem:[self header:@"Tailscale not installed"]];
    }
    if (!self.serverPath) [menu addItem:[self header:@"server.py not found"]];
    [menu addItem:NSMenuItem.separatorItem];

    NSMenuItem *action = [[NSMenuItem alloc] initWithTitle:(on ? @"Turn Off" : @"Turn On")
                                                    action:@selector(toggle:)
                                             keyEquivalent:@"t"];
    action.target = self;
    [menu addItem:action];

    [menu addItem:NSMenuItem.separatorItem];
    [menu addItem:[[NSMenuItem alloc] initWithTitle:@"Quit"
                                             action:@selector(terminate:)
                                      keyEquivalent:@"q"]];
    menu.delegate = self;
    self.statusItem.menu = menu;
}

/// Tailscale can be stopped from its own menu bar item, so re-check on open
/// rather than trusting the value from launch time.
- (void)menuWillOpen:(NSMenu *)menu {
    BOOL up = [self checkTailscale];
    if (up != self.tailscaleUp) {
        self.tailscaleUp = up;
        [self render];
    }
}

- (NSMenuItem *)header:(NSString *)text {
    NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:text action:nil keyEquivalent:@""];
    item.enabled = NO;
    return item;
}

#pragma mark - Helpers

- (NSString *)runCapturing:(NSString *)tool arguments:(NSArray<NSString *> *)args {
    NSTask *task = [NSTask new];
    task.executableURL = [NSURL fileURLWithPath:tool];
    task.arguments = args;
    NSPipe *pipe = [NSPipe pipe];
    task.standardOutput = pipe;
    task.standardError = NSFileHandle.fileHandleWithNullDevice;
    if (![task launchAndReturnError:nil]) return @"";
    NSData *out = [pipe.fileHandleForReading readDataToEndOfFile];
    [task waitUntilExit];
    return [[NSString alloc] initWithData:out encoding:NSUTF8StringEncoding] ?: @"";
}

/// pid listening on our port, or 0.
- (pid_t)portHolder {
    NSString *out = [self runCapturing:@"/usr/sbin/lsof"
                             arguments:@[ @"-nP", [NSString stringWithFormat:@"-iTCP:%@", self.port],
                                          @"-sTCP:LISTEN", @"-t" ]];
    NSString *trimmed =
        [out stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
    return (pid_t)trimmed.intValue;
}

/// Only ever reclaim a process that is running the same server.py we would.
- (BOOL)isOurGateway:(pid_t)pid {
    if (!self.serverPath) return NO;
    NSString *cmd = [self runCapturing:@"/bin/ps"
                             arguments:@[ @"-o", @"command=", @"-p",
                                          [NSString stringWithFormat:@"%d", pid] ]];
    return [cmd containsString:self.serverPath];
}

- (void)warnPortBusy {
    NSAlert *alert = [NSAlert new];
    alert.messageText = [NSString stringWithFormat:@"Port %@ is already in use", self.port];
    alert.informativeText =
        @"Another process is serving this port - most likely the launchd "
        @"agent. Stop it so this app can own the gateway:\n\n"
        @"launchctl bootout gui/$(id -u)/com.herdr.mobile";
    alert.alertStyle = NSAlertStyleWarning;
    [alert runModal];
}

@end

int main(void) {
    @autoreleasepool {
        NSApplication *app = NSApplication.sharedApplication;
        Controller *controller = [Controller new];
        app.delegate = controller;
        // Menu bar only: no Dock icon, no app switcher entry.
        [app setActivationPolicy:NSApplicationActivationPolicyAccessory];
        [app run];
    }
    return 0;
}
