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
Tailscale Serve (https://herdr.<your-tailnet>.ts.net -> :3000)
      │
      ▼
herdr-mobile gateway (server.py on port 3000)
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

### 3. Run as Systemd Service (Autostart)
```bash
sudo cp herdr-mobile.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now herdr-mobile.service
```

### 4. Tailscale Serve (HTTPS on Tailnet)
If not already active:
```bash
tailscale serve --bg 3000
```

---

## Adding to iPhone Home Screen

1. On your iPhone connected to Tailscale, open Safari and navigate to:
   ```text
   https://herdr.<your-tailnet>.ts.net
   ```
2. Tap the **Share** button (box with upward arrow) at the bottom.
3. Tap **"Add to Home Screen"**.
4. Launch **Herdr** from your home screen as a standalone web app!
