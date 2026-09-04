# herdr-mobile 📱

A minimal, distraction-free mobile web interface for [Herdr](https://herdr.dev) running on your server, designed specifically for iPhone and Tailscale.

## Features

- **PWA for iOS**: Add to Home Screen for a native, full-screen iOS app feel without browser chrome.
- **Native iOS Dictation**: Use native iOS voice-to-text directly from the virtual keyboard microphone into prompts.
- **Scrollable History**: Live output transcript from active Herdr agent panes with auto-scroll and jump-to-bottom toggle.
- **Agent Switcher**: Simple tap-to-switch carousel showing all active agents with live status badges (🟢 Idle, 🟡 Working, 🔴 Blocked).
- **Tactile Quick Actions**: Send, `Ctrl+C` interrupt, `Esc`, and clipboard copy buttons.
- **Zero-Dependency Gateway**: Single lightweight Python backend connecting directly to Herdr's UNIX domain socket (`herdr.sock`).
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

### 3b. Autostart on macOS (launchd)
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

When coding agents start local development servers (e.g., Nuxt, Next.js, Vite), they often bind to common ports like `3000` or `5173`. Here is how they coexist cleanly with Herdr Mobile on your Tailnet:

### 1. Internal Port Isolation
Herdr Mobile defaults to internal port **`3009`** (instead of standard `3000`). This ensures agents starting frameworks that default to `3000` never collide with Herdr Mobile.

### 2. Dedicated HTTPS Port for Herdr Mobile (`:8443`)
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
# Herdr Mobile on /herdr
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
