<div align="center">

<img src="web/icon.svg" alt="" width="112" height="112">

# SheepIt

**Manage your local agent herd remotely on your phone.**

</div>

Your coding agents run on the machine under your desk. SheepIt puts them in
your pocket: read what an agent is doing, answer the question it is stuck on,
and start the next one — from the sofa, the kitchen, or the bus.

It is a small web app you add to your iPhone home screen, plus a
standard-library Python gateway that talks to [Herdr](https://herdr.dev), the
terminal multiplexer your agents are running in. No accounts, no cloud, no
dependencies: the phone reaches your own machine over your own
[Tailscale](https://tailscale.com) network.

| | | |
|---|---|---|
| <img src="docs/media/agent.png" alt="An agent's transcript on the phone"> | <img src="docs/media/projects.png" alt="The project list, one sheep per project"> | <img src="docs/media/menubar.png" alt="The macOS menu bar app"> |
| Read an agent and answer it | Your herd, most recent first | One switch on the Mac |

## Why

An agent works for ten minutes, then stops to ask which of three options you
want — and until you walk back to the laptop, it waits. SheepIt closes that
gap. The phone shows the question, the keys to answer it, and a sheep per
project telling you at a glance who is working and who is waiting.

## What you get

- **Answer prompts from the phone.** Selection prompts render as their own
  card, with number keys that follow however many options the agent listed.
- **Your herd at a glance.** One sheep per project, coloured *and* posed by
  what its agent is doing: grazing while it works, head up when idle, ear
  pricked when blocked, asleep when done. Sorted by whatever changed last.
- **Notifications when an agent finishes**, off your network with the phone
  locked, plus a count on the home screen icon.
- **A bleat.** A sheep answers when an agent stops, if the app is open.
- **Native dictation.** Talk to your agent using the iOS keyboard's mic.
- **A menu bar switch on the Mac** that starts everything the phone needs and
  keeps the machine awake so notifications can actually arrive.

## How it fits together

```
iPhone (home screen web app)
      │  HTTPS over your tailnet
      ▼
Tailscale Serve
      │
      ▼
SheepIt gateway  ── gateway/server.py, Python standard library only
      │  UNIX domain socket
      ▼
Herdr server  ── your agents, in their panes
```

The gateway never reaches the public internet. It reads and writes one UNIX
socket belonging to Herdr, and serves the `web/` directory to your phone.

## Quick start

You need Python 3.10+, a running [Herdr](https://herdr.dev), and Tailscale on
both machines.

```bash
git clone https://github.com/mowolf/herdr-mobile.git sheepit
cd sheepit
python3 gateway/server.py                      # http://127.0.0.1:3009
tailscale serve --bg --https=8443 http://127.0.0.1:3009
```

Then open `https://<node>.<tailnet>.ts.net:8443` in Safari on the phone and
**Share → Add to Home Screen**. On a Mac, `make -C menubar login` replaces all
of that with one switch in the menu bar.

Full instructions, autostart units and Tailscale routing live in
**[docs/gateway.md](docs/gateway.md)**.

## Repository layout

| | |
|---|---|
| `gateway/` | The Python gateway: `server.py` serves the app and proxies Herdr's socket; `push.py` signs Web Push. |
| `web/` | The phone app — plain HTML, CSS and JavaScript, no build step. |
| `menubar/` | `SheepIt.app`, the macOS menu bar switch. One `clang` invocation, no Xcode project. |
| `deploy/` | systemd and launchd units for running the gateway unattended. |
| `tools/` | Asset generators, currently the synthesised bleat. |
| `docs/` | Everything below. |

## Documentation

- **[docs/gateway.md](docs/gateway.md)** — install, run, autostart, ports, and
  sharing a tailnet with dev servers.
- **[docs/push.md](docs/push.md)** — notifications on iOS, and what a
  standard-library push implementation can and cannot do.
- **[docs/design.md](docs/design.md)** — the sheep, the postures, the bleat,
  the icons, and the iOS limits that shaped them.
- **[menubar/README.md](menubar/README.md)** — the macOS app.

## Naming

*Herdr* and *Tailscale* are other people's programs, and are named here only
where they are meant: Herdr's socket, Tailscale's commands. Everything that
belongs to this repository is SheepIt — `SHEEPIT_*` environment variables,
`~/.config/sheepit/`, `com.sheepit.*` services.

## Licence

[PolyForm Noncommercial 1.0.0](LICENSE.md). Use it, change it, share your
changes — for anything noncommercial. Personal and hobby use, study, charities,
schools and public institutions are all covered.

Selling it, or using it as part of a commercial product or service, is not.
For that, ask: <moritz@moritzwolf.com>.

Note this is a *source-available* licence, not an open-source one — the
noncommercial restriction is exactly what the OSI definition disallows. If you
need an OSI licence for a policy reason, this is not it.
