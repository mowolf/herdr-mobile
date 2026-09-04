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
Tailscale Serve (https://herdr.<tailnet>.ts.net:8443 or :443)
      │
      ▼
herdr-mobile gateway (server.py on internal port 3009)
      │
      ▼ UNIX domain socket
Herdr Server (/root/.config/herdr/herdr.sock)
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
Default internal port: `3009` (configurable via `PORT=3009`).

### 3. Run as Systemd Service (Autostart)
```bash
sudo cp herdr-mobile.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now herdr-mobile.service
```

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
* **Recommended for iPhone PWA**: Save `https://herdr.<tailnet>.ts.net:8443` to your iPhone home screen.
* This leaves standard port `443` (`https://herdr.<tailnet>.ts.net`) completely free for whatever dev server you or an agent want to proxy!

### 3. Direct Port Access on the Tailnet (No Proxy Needed)
Tailscale operates as a secure mesh VPN. The firewall on `tailscale0` allows all incoming traffic from your tailnet. Any dev server bound to `0.0.0.0` is **immediately accessible over plain HTTP** directly from your iPhone browser:
* Nuxt / Next.js: `http://herdr.<tailnet>.ts.net:3000`
* Vite / Svelte: `http://herdr.<tailnet>.ts.net:5173`
* Flask / FastAPI: `http://herdr.<tailnet>.ts.net:8000`

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
   https://herdr.<tailnet>.ts.net:8443
   ```
   *(or `https://herdr.<tailnet>.ts.net` if using port 443)*
3. Tap the **Share** button (box with upward arrow) at the bottom.
4. Tap **"Add to Home Screen"**.
5. Launch **Herdr** from your home screen as a standalone, distraction-free app.

---

## Technical Notes & Implementation Details

- **Percent-Encoded Pane IDs**: Mobile Safari URL-encodes colons in pane identifiers (e.g. `w1:p2` becomes `w1%3Ap2`). The backend gateway automatically unquotes path components with `urllib.parse.unquote` before passing targets to Herdr's UNIX domain socket.
- **iOS Virtual Keyboard Handling**: The HTML viewport uses `interactive-widget=resizes-content` and `viewport-fit=cover`. This ensures that on iOS 16.4+, Safari resizes the visual viewport when the on-screen keyboard appears, keeping the prompt input pinned cleanly above the keyboard without UI jumping.
- **Battery Optimization**: The client listens to the `visibilitychange` event. Polling stops automatically when the iPhone locks or Safari is backgrounded, and resumes with an immediate refresh upon waking.
