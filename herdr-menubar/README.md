# HerdrMenuBar

A menu bar switch for the herdr-mobile gateway on Apple Silicon macOS.

One toggle drives the three things the phone needs, which otherwise have to be
started by hand and drift out of step:

| | |
|---|---|
| **Gateway** | runs `server.py` on `127.0.0.1:3009` |
| **Tailscale** | brought up if it is stopped — the phone reaches the gateway over the tailnet |
| **`caffeinate -s`** | an asleep Mac cannot send a push notification, so alerts silently never arrive |

The bar icon shows the state: a filled antenna when running, slashed and dimmed
when off.

## Build

```bash
make          # build/HerdrMenuBar.app
make run      # build and launch
make install  # copy to /Applications, so it can be added to Login Items
```

No Xcode project and no dependencies — a single `clang` invocation against
AppKit. It is written in Objective-C rather than Swift deliberately: Command
Line Tools installs that carry a stale `SwiftBridging` modulemap fail every
Swift AppKit build, and clang is unaffected.

## Notes

`server.py` is located by walking up from the bundle, so a build inside the
repository finds it automatically. Override with the `serverPath` user default
or the `HERDR_SERVER` environment variable; `HERDR_PORT` changes the port.

The app and the launchd agent cannot both own the port. If you use this app,
remove the agent:

```bash
launchctl bootout gui/$(id -u)/com.herdr.mobile
rm ~/Library/LaunchAgents/com.herdr.mobile.plist
```

An orphaned gateway from a previous run is reclaimed automatically — but only
after confirming it is running the same `server.py`, never an unrelated
process. `caffeinate` is started with `-w <pid>`, so it exits with the app even
if the app is killed, rather than holding the Mac awake indefinitely.
