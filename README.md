# Sheep It 🐑

A minimal, distraction-free mobile web interface for [Herdr](https://herdr.dev)
running on your server, designed specifically for iPhone and Tailscale. Herd
your agents from the couch and, when one asks, sheep it.

The app is **Sheep It**; the repository, the gateway process and the service
files keep the `herdr-mobile` name.

## Features

- **PWA for iOS**: Add to Home Screen for a native, full-screen iOS app feel without browser chrome.
- **Native iOS Dictation**: Use native iOS voice-to-text directly from the virtual keyboard microphone into prompts.
- **Readable Transcript**: The pane's output is parsed into blocks and coloured by speaker, mirroring the terminal's own ANSI colours. Full-width rules collapse to hairlines and tables keep their alignment, so nothing wraps into a wall of dashes.
- **Project Picker**: A dropdown naming the current project, with a full-screen list of every workspace, each shown as a sheep whose fleece *and posture* carry its status: grazing while an agent works (🟡), head up and waiting when it is idle (🟢), ear pricked when it is blocked (🔴), asleep once it is done (🔵) - and a pane with no agent is an empty pasture with no sheep at all. Most recent first: the phone remembers which projects last changed and which you last opened, shows the age of that change against each row, and holds the order steady while the list is on screen. Create a workspace with **New**; swipe a row left to close one.
- **Key Palette**: `y`, `n`, number keys, arrows, tab and enter for the confirmation prompts agents stop on, plus `Esc` and `Ctrl+C`. The number keys follow the prompt on screen, so a question with five options gets five keys.
- **Selection Prompts**: The question an agent is waiting on renders as its own card instead of being mistaken for the desktop's input box, so choices never go missing on the phone.
- **Desktop Input Mirror**: Shows what is typed into the pane on the laptop, with one tap to pull it into the phone's composer.
- **Push Notifications**: Get told when an agent finishes, even off the tailnet with the phone locked. See [Push Notifications](#push-notifications-ios).
- **Bleat**: A sheep answers when an agent stops working while you have the app open. Toggle it in settings; see [The Bleat](#the-bleat).
- **Home Screen Badge**: The icon carries the number of agents waiting on you, and clears itself as you answer them. See [The Home Screen Icon](#the-home-screen-icon-ios).
- **Agent Mode**: Cycle auto / manual / plan from settings without reaching for the laptop.
- **Zero-Dependency Gateway**: Single lightweight Python backend connecting directly to Herdr's UNIX domain socket (`herdr.sock`). Standard library only; `openssl` is used for push signing.
- **Secure by Default**: Served over your private Tailscale Tailnet with automated HTTPS.

---

## Architecture

```
iPhone (Safari PWA)
      │
      │ HTTPS (over Tailscale)
      ▼
Tailscale Serve (https://<node>.<tailnet>.ts.net:8443 or :443)
      │
      ▼
herdr-mobile gateway (server.py on internal port 3009)
      │
      ▼ UNIX domain socket
Herdr Server (~/.config/herdr/herdr.sock)
```

---

## Setup & Running

### 1. Requirements
* Python 3.10+ (standard library only, no pip dependencies needed)
* Running `herdr` session or server on the machine
* Tailscale (optional, for remote access)

### 2. Run Manually
```bash
python3 server.py
```
Default internal port: `3009` (configurable via `PORT=3009`), bound to `127.0.0.1`.

The Herdr socket is located automatically: `HERDR_SOCKET` if set, otherwise
`~/.config/herdr/herdr.sock`, falling back to `/root/.config/herdr/herdr.sock`.

> **fish shell:** `VAR=value python3 server.py` does not set the variable in fish.
> Use `env PORT=3009 python3 server.py` instead.

### 3a. Autostart on Linux (systemd)
```bash
sudo cp herdr-mobile.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now herdr-mobile.service
```

### 3b. Menu bar app (macOS, recommended)

[`herdr-menubar/`](herdr-menubar) builds **SheepIt.app**, a small Apple Silicon menu bar app that
runs the gateway, starts `herdr server` if no Herdr is listening, brings
Tailscale up, and holds `caffeinate -s` so the Mac stays awake — an asleep Mac
cannot send push notifications, so alerts would silently never arrive. One
toggle drives all four.

Turning it off leaves Herdr running: the headless server holds every open pane
and agent, so stopping it is `herdr server stop`.

```bash
make -C herdr-menubar install   # then add it to Login Items
```

It replaces an earlier `HerdrMenuBar.app` and quits any copy still running -
the menu bar icon is drawn by the binary, so a live instance keeps drawing its
own however many times the app is replaced on disk.

It cannot share the port with the launchd agent below; use one or the other.

### 3c. Autostart on macOS (launchd)
```bash
sed "s|HERDR_MOBILE_DIR|$PWD|g" com.herdr.mobile.plist > ~/Library/LaunchAgents/com.herdr.mobile.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.herdr.mobile.plist
```
Logs go to `herdr-mobile.log` in the repo directory. To check, restart, or remove:
```bash
launchctl print gui/$(id -u)/com.herdr.mobile
launchctl kickstart -k gui/$(id -u)/com.herdr.mobile
launchctl bootout gui/$(id -u)/com.herdr.mobile
```

The plist runs `/usr/bin/python3` (system Python) rather than a Homebrew Python
deliberately: the macOS application firewall ships with `/usr/bin/python3`
allowed for incoming connections, while a Homebrew interpreter is not — so a
Homebrew-launched server can be silently unreachable from other devices.

---

## The Home Screen Icon (iOS)

A blue sheep on a moonlit pasture, in `static/icon.svg` - the same animal the
project list draws, blown up to 512 and given a landscape. The PNGs beside it
are rasterised from that one file, so edit the SVG and regenerate:

```bash
for s in 180 192 512; do
  qlmanage -t -s $s -o /tmp/icons static/icon.svg
  mv /tmp/icons/icon.svg.png static/icon-$s.png
done
```

Three things about iOS are worth knowing before trying to make the icon say
anything:

* **iOS ignores both the manifest icons and an SVG `apple-touch-icon`.** The
  home screen icon comes from the PNG in `<link rel="apple-touch-icon">`; point
  it at an SVG and iOS falls back to a screenshot of the page.
* **The icon is snapshotted when the app is added to the home screen** and is
  never fetched again. Changing the PNG, the `<link>`, or the manifest does
  nothing to an install that already exists - the only way to pick up a new
  icon is **long-press -> Remove App**, then add it again from Safari. There is
  no API to change an installed icon, so it cannot reflect live state: no sheep
  per agent, no colour per status.
* **The badge is the exception.** `navigator.setAppBadge()` works on an
  installed home screen web app (iOS 16.4+) and is the one part of the icon
  that updates, so it carries the count of agents waiting on you - set while
  the app is open and again from the push handler while it is closed. It needs
  granted notification permission, the same one push uses; without it the badge
  silently never appears.

The icon is drawn full bleed, with no rounded corners of its own, because iOS
applies its own mask on top.

The home screen *name* is snapshotted the same way, from
`apple-mobile-web-app-title`. An install made before the app was called **Sheep
It** still reads "Herdr" underneath its icon until it is removed and added
again.

---

## The Bleat

`static/bleat.wav` is a synthesised "määäh", played once whenever an agent goes
from working to stopped while the app is open. Several agents finishing in the
same sweep still get one bleat; eight sheep at once is a farmyard, not a
notification. **gear → Bleat when an agent finishes** turns it off, and
toggling it back on plays it so you hear what you enabled.

There is no sample to license or lose: the sound is generated, and the
generator is committed next to it.

```bash
python3 make_bleat.py   # rewrites static/bleat.wav
```

It is a buzzy glottal source under three formant resonators tuned to an open
`ä`, with the first swept up from a closed nasal onset so it opens like
"m-ää", a falling pitch and the 26 Hz tremolo that makes a bleat sound like a
sheep instead of a synth tone.

**Push notifications cannot carry it.** The Notification API's `sound` property
was dropped from the standard in 2018 for want of implementations, and iOS
plays its own system sound for web push regardless. Nothing in the service
worker can change that, so the bleat is a foreground sound only - which is also
why iOS demands one touch on the page before it will let the app make any noise
at all.

---

## Push Notifications (iOS)

Get a notification when an agent stops working - the same moment the desktop
chimes.

1. Install the PWA to the iOS home screen (Web Push does not work in Safari
   tabs, only in an installed PWA, iOS 16.4+).
2. Open it from the home screen, then **gear -> Notify when an agent finishes**
   and accept the iOS prompt.

Delivery goes through Apple's push service rather than your tailnet, so alerts
arrive on cellular with the phone locked. The gateway must be awake to send
them - on a laptop that sleeps, run `caffeinate -s`.

**Requires** the `openssl` binary (present on macOS and most Linux hosts).
Python's standard library has no ECDSA, so the VAPID JWT is signed by shelling
out to it. No pip packages are needed.

VAPID keys and device subscriptions are generated on first use and stored, mode
`600`, in `~/.config/herdr-mobile/` (override with `HERDR_STATE_DIR`). They are
outside the repository and must never be committed. `HERDR_PUSH_SUB` sets the
RFC 8292 contact sent to the push service.

Pushes carry no payload: encrypting one requires ECDH + AES-GCM, which the
standard library cannot do. Instead `sw.js` fetches `/api/agents` when it wakes
and names whichever agent stopped, so notifications show the real project name.

```bash
curl -X POST http://127.0.0.1:3009/api/push/test   # fire a test push
```

`201` means the push service accepted it; `404`/`410` mean the subscription is
dead and it is dropped automatically.

---

## Exposing Multiple Apps & Dev Servers via Tailscale

When coding agents start local development servers (e.g., Nuxt, Next.js, Vite), they often bind to common ports like `3000` or `5173`. Here is how they coexist cleanly with Sheep It on your Tailnet:

### 1. Internal Port Isolation
Sheep It defaults to internal port **`3009`** (instead of standard `3000`). This ensures agents starting frameworks that default to `3000` never collide with it.

### 2. Dedicated HTTPS Port for Sheep It (`:8443`)
Tailscale Serve supports multiple HTTPS ports with valid automated certificates:
```bash
tailscale serve --bg --https=8443 http://127.0.0.1:3009
```

> **Prerequisite:** HTTPS certificates must be enabled for your tailnet
> (admin console → **DNS** → **HTTPS Certificates** → Enable). Without it,
> `tailscale serve --https` hangs and writes no config, and `tailscale cert`
> reports *"your Tailscale account does not support getting TLS certs"*.
> Verify with `tailscale status --json | grep CertDomains` — it must list your
> node, not `null`.

* **Recommended for iPhone PWA**: Save `https://<node>.<tailnet>.ts.net:8443` to your iPhone home screen
  (find the exact name with `tailscale status --json | grep DNSName`).
* This leaves standard port `443` (`https://<node>.<tailnet>.ts.net`) completely free for whatever dev server you or an agent want to proxy!

### 3. Direct Port Access on the Tailnet (No Proxy Needed)
Tailscale operates as a secure mesh VPN. The firewall on `tailscale0` allows all incoming traffic from your tailnet. Any dev server bound to `0.0.0.0` is **immediately accessible over plain HTTP** directly from your iPhone browser:
* Nuxt / Next.js: `http://<node>.<tailnet>.ts.net:3000`
* Vite / Svelte: `http://<node>.<tailnet>.ts.net:5173`
* Flask / FastAPI: `http://<node>.<tailnet>.ts.net:8000`

*(Note: Use HTTP for dev servers; only PWAs requiring home-screen installation and mic access need HTTPS via Tailscale Serve).*

### 4. Path-Based Routing on Port 443 (Optional)
Tailscale Serve can also route different URL paths on port 443 to different local services:
```bash
# Sheep It on /herdr
tailscale serve --bg --set-path /herdr http://127.0.0.1:3009

# Agent dev server on root / or /preview
tailscale serve --bg --set-path /preview http://127.0.0.1:5173
```

### 5. Useful Tailscale Serve Commands
```bash
# Check active serve rules
tailscale serve status

# View raw JSON routing table
tailscale serve status --json

# Remove a specific port proxy
tailscale serve --https=8443 off
tailscale serve --https=443 off

# Reset all serve rules
tailscale serve reset
```

---

## Adding to iPhone Home Screen

1. Ensure Tailscale VPN is connected on your iPhone.
2. Open Safari and navigate to:
   ```text
   https://<node>.<tailnet>.ts.net:8443
   ```
   *(or `https://<node>.<tailnet>.ts.net` if using port 443)*
3. Tap the **Share** button (box with upward arrow) at the bottom.
4. Tap **"Add to Home Screen"**.
5. Launch **Herdr** from your home screen as a standalone, distraction-free app.

---

## Technical Notes & Implementation Details

- **Percent-Encoded Pane IDs**: Mobile Safari URL-encodes colons in pane identifiers (e.g. `w1:p2` becomes `w1%3Ap2`). The backend gateway automatically unquotes path components with `urllib.parse.unquote` before passing targets to Herdr's UNIX domain socket.
- **iOS Virtual Keyboard Handling**: The HTML viewport uses `interactive-widget=resizes-content` and `viewport-fit=cover`. This ensures that on iOS 16.4+, Safari resizes the visual viewport when the on-screen keyboard appears, keeping the prompt input pinned cleanly above the keyboard without UI jumping.
- **Battery Optimization**: The client listens to the `visibilitychange` event. Polling stops automatically when the iPhone locks or Safari is backgrounded, and resumes with an immediate refresh upon waking.
