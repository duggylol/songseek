# SongSeek

A desktop song-request jukebox for Twitch streamers. Viewers redeem a channel-point reward
(or type a chat command) with a song name or link, and SongSeek finds it on **Spotify,
YouTube or SoundCloud**, queues it, and plays it — **without Spotify, a browser tab, or
anything else open**. Your stream hears it as normal desktop audio.

- Spotify-style dashboard: big artwork + controls on the left, live queue on the right (25%)
- **Spotify works with just a login button** — no developer account, no setup
- Channel-point redemptions **and** an optional `!sr` chat command
- Accepts song names or direct Spotify / YouTube / SoundCloud links
- In-app search across all three sources (Spotify results first)
- Packages to a Windows `.exe` install wizard and a macOS `.dmg`

## How Spotify playback works (important)

SongSeek plays Spotify audio through a bundled open-source engine
([go-librespot](https://github.com/devgianlu/go-librespot)) that speaks Spotify's Connect
protocol — the same mechanism your phone uses to play to a speaker. This is why there's no
developer app and no per-user allowlist: users just click **Connect Spotify** and log in.

- **Spotify Premium is required** (Spotify only allows this for Premium accounts).
- It's an unofficial client. It's widely used and reliable, but it is not endorsed by
  Spotify, so in principle Spotify could change something that temporarily breaks it.
- Everything (your login, tokens, queue) is stored **only on your machine**, in the app's
  user-data folder. Nothing is sent anywhere except to Spotify/Twitch to log you in.

---

## Run it (development)

```bash
npm install
npm run dev
```

The Spotify engine binaries are prebuilt and committed under `resources/bin/`, so there is
nothing else to install. Test without going live: Settings → **Test** → type a song → Send.

## Build installers

```bash
npm run dist:mac     # → release/SongSeek-0.1.0-arm64.dmg     (build on macOS)
npm run dist:win     # → release/SongSeek-Setup-0.1.0.exe     (step-by-step wizard)
```

Both installers can be built **from a Mac** — the Windows `.exe` cross-builds; no Windows
machine needed. (The Windows build is a proper wizard: install location, desktop shortcut,
launch-when-done.)

---

## First-run setup (for whoever uses the app)

1. **Connect Spotify** — click the button, log into Spotify in the browser (Premium
   account), done. The status pill shows "Spotify · player ready".
2. **Connect Twitch** — click, enter the short code shown on twitch.tv/activate.
3. **Create the channel-point reward** — on your Twitch dashboard, add a custom reward
   (e.g. "Song Request") with **"Require viewer to enter text"** enabled. Its name must
   match the reward name in SongSeek's settings. (Channel points need Affiliate/Partner;
   the `!sr` chat command works for everyone.)

That's it. There is **no Spotify developer setup at all**.

## Giving SongSeek to other streamers

To make Twitch one-click too (so your users skip the Twitch developer console), bake in your
own Twitch app's Client ID before building:

1. Register a **Public** app at the [Twitch Developer Console](https://dev.twitch.tv/console/apps)
   (redirect URL `http://localhost`), copy its Client ID.
2. Paste it into [app-config.json](app-config.json) → `twitchClientId`, then build the
   installers and share the files from `release/`.

Your users then only: install → **Connect Spotify** → **Connect Twitch** → create the
reward. Spotify needs nothing baked in — it already works for anyone with Premium.

Caveats when sharing:

- The installers are not code-signed, so Windows SmartScreen shows "unknown publisher"
  (More info → Run anyway) and macOS needs right-click → Open the first time. A code-signing
  certificate removes this but is optional.

## Stream audio

SongSeek plays audio like any desktop app, so OBS's **Desktop Audio** captures it
automatically. To keep music on its own mixer track, route SongSeek through a virtual audio
device (VoiceMeeter / VB-Cable on Windows, BlackHole + Loopback on macOS).

## How requests are resolved

1. Direct links (`open.spotify.com/track/…`, `youtu.be/…`, `soundcloud.com/…`) play on that
   platform.
2. Free text is searched **Spotify → YouTube → SoundCloud**; the first hit is queued.

---

## Rebuilding the Spotify engine binaries (optional)

The prebuilt `go-librespot` binaries in `resources/bin/` were cross-compiled on macOS. To
reproduce them (e.g. to update the version), see [build/librespot/](build/librespot/):

```bash
# needs: brew install go mingw-w64 libvorbis flac libogg pkg-config
build/librespot/build-wincodecs.sh     # cross-build ogg/vorbis/flac for Windows
build/librespot/patch-gls.sh <repo>    # small Windows portability patches
# then cross-compile go-librespot for windows/amd64 and build native for darwin
```

## Notes & limitations

- **Spotify Premium required** for Spotify playback.
- YouTube playback shows the actual video in the artwork area; videos that disallow
  embedding are skipped automatically.
- YouTube/SoundCloud search use those sites' public web endpoints; if a site changes its
  markup, search for that source may need a patch — direct links always work.
- The macOS build is unsigned (fine for personal testing — right-click → Open the first time).
