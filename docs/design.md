# The sheep, the sound, and the icons

Notes on the parts of SheepIt that exist to be understood at a glance, and on
the iOS limits that shaped them.

## The flock

The project list draws one sheep per project. Colour carries the status, and so
does the posture — a silhouette needs no legend:

| State | Sheep | Motion |
|---|---|---|
| Working 🟡 | grazing, head down | munching bob |
| Idle 🟢 | standing, head up | still |
| Blocked 🔴 | head up, ear pricked | twitch |
| Done 🔵 | lying down asleep | slow breathing |
| Unknown ⚪ | no sheep — empty pasture | none |

Idle stands rather than sleeps on purpose: it is the state that most wants
answering, so it must not look like the dormant one. The pane with no agent at
all is the empty pasture. Every animation stops under
`prefers-reduced-motion`.

The sheep is inline SVG so the fleece can inherit each row's colour, which is
also why the face and ear are pale with a card-coloured outline: a dark muzzle
disappears into the dark card and leaves a headless blob.

## Sorting by recency

Herdr exposes no timestamps, but every pane carries a `state_change_seq` that
only grows. The gateway passes it through and the phone stamps a wall-clock
time whenever it moves — or whenever you open a project. Both live in
`localStorage`, so the order is *this phone's* rather than the server's
workspace numbering, and it survives a reload.

A first sighting is not a change. Rows seen only sitting still sort by
sequence but show no age, rather than claiming everything happened the moment
the app first looked. The order is also held steady while the list is open, so
a state change cannot slide a row out from under the thumb about to tap it.

## The bleat

`web/bleat.wav` is a synthesised "määäh", played once when an agent stops
working while the app is open. Several agents finishing in one sweep still get
one bleat; eight sheep at once is a farmyard, not a notification. Turn it off
under **gear → Bleat when an agent finishes**.

There is no sample to license or lose — the sound is generated, and the
generator is committed beside it:

```bash
python3 tools/make-bleat.py     # rewrites web/bleat.wav
```

It is a buzzy glottal source under three formant resonators tuned to an open
`ä`, the first swept up from a closed nasal onset so it opens like "m-ää", with
a falling pitch and the 26 Hz tremolo that makes a bleat sound like a sheep
rather than a synth tone. The upper formants are lifted hard, because a glottal
source rolls off at -6 dB/octave and without that the vowel comes out closer to
"moo".

iOS will not let a page make a sound until it has been touched once, so the
audio context is created and the file decoded on the first interaction.
[Notifications cannot carry it](push.md#custom-sounds-are-not-possible).

## The home screen icon

`web/icon.svg` is the same sheep, in blue on a moonlit pasture. The PNGs beside
it are rasterised from that one file:

```bash
for s in 180 192 512; do
  qlmanage -t -s $s -o /tmp/icons web/icon.svg
  mv /tmp/icons/icon.svg.png web/icon-$s.png
done
```

Three things about iOS are worth knowing before trying to make the icon say
anything:

* **iOS ignores manifest icons and refuses an SVG `apple-touch-icon`.** The
  home screen icon comes from the PNG in `<link rel="apple-touch-icon">`; point
  it at an SVG and iOS falls back to a screenshot of the page.
* **The icon is snapshotted when the app is added, and never fetched again.**
  Changing the PNG, the link or the manifest does nothing to an install that
  already exists — the only way to pick up a new icon, or a new name, is
  long-press → **Remove App** and add it again. There is no API to change an
  installed icon, so it cannot reflect live state: no sheep per agent, no
  colour per status.
* **The badge is the exception.** `navigator.setAppBadge()` works in an
  installed home-screen app (iOS 16.4+) and is the one part of the icon that
  still updates, so it carries the number of agents waiting on you — set while
  the app is open, and again from the push handler while it is closed. It needs
  granted notification permission.

The icon is drawn full bleed with no rounded corners of its own, because iOS
applies its own mask on top.

## The Mac icons

Two of them, and they are not the same drawing for good reason.

The **menu bar** icon is drawn in code, in `menubar/main.m`. A menu bar image
is a *template*: one alpha channel that AppKit tints for the light or dark bar,
so it cannot carry colour, and the head has to be told from the fleece by
cutting the gap out of the silhouette rather than by outlining it.

The **Finder** icon is the phone's icon, wrapped by `menubar/make-icns.py` in
the rounded rectangle macOS expects — unlike iOS, macOS does not mask an app
icon, so a full-bleed square would sit in the Dock as a square tile. Wrapping
the same SVG keeps one sheep to edit rather than two.

If a rebuild seems to change nothing, note that the menu bar icon lives in the
binary: a copy left running keeps drawing its own. `make -C menubar install`
quits any running copy first.
