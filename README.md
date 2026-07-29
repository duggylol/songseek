# SongSeek

A desktop song-request companion for Twitch streamers. Viewers redeem a channel-point reward
(or type a chat command) with a song name or link, and SongSeek finds it on **Spotify,
YouTube or SoundCloud** and queues it.

SongSeek is a **remote control for your own Spotify app** — it doesn't play Spotify audio
itself. Keep Spotify open and playing; requests are added to Spotify's native queue, so the
requested song plays next and then your playlist carries on exactly where it was. YouTube and
SoundCloud requests (which can't go in Spotify's queue) play inside SongSeek, pausing Spotify
for the clip and resuming afterwards.

- Spotify-style dashboard: big artwork + controls on the left, live queue on the right (25%)
- **Spotify: one login button** — SongSeek controls your open Spotify app
- Channel-point redemptions **and** an optional `!sr` chat command
- Accepts song names or direct Spotify / YouTube / SoundCloud links
- In-app search across all three sources (Spotify results first)
- Packages to a Windows `.exe` install wizard and a macOS `.dmg`

## How Spotify playback works (important)

**Spotify must be open and playing.** SongSeek does not play Spotify audio — it controls
your Spotify app through Spotify's official Web API (the same thing the phone remote does):

- Requests are added to **Spotify's own queue**, so a requested song plays next and then
  Spotify continues your playlist/album exactly where it was. Nothing is hijacked.
- SongSeek holds pending requests itself and hands Spotify **one at a time**, which is why
  you can still remove or clear requests. (The song already handed to Spotify can't be
  pulled back — Spotify has no remove-from-queue API — so skip past that one.)
- **Spotify Premium is required** (Spotify requires it for playback control).
- Everything (your login, tokens, queue) is stored **only on your machine**.

---

## Run it (development)

```bash
npm install
npm run dev
```

The bundled `yt-dlp` binaries live in `resources/bin/`, so there is nothing else to install.
Test without going live: Settings → **Test** → type a song → Send.

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

1. **Connect Spotify** — click the button and log in (Premium account). Then **open the
   Spotify app and play something**; the status pill turns green once SongSeek sees it.
2. **Connect Twitch** — click and approve in the browser.
3. **Create the channel-point reward** — on your Twitch dashboard, add a custom reward
   (e.g. "Song Request") with **"Require viewer to enter text"** enabled. Its name must
   match the reward name in SongSeek's settings. (Channel points need Affiliate/Partner;
   the `!sr` chat command works for everyone.)

That's it — as long as Spotify is running, requests land in its queue.

## Giving SongSeek to other streamers

Bake your app credentials into the build so your users never touch a developer dashboard —
see [app-config.example.json](app-config.example.json):

1. **Spotify**: create an app at [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard)
   with Redirect URIs `http://127.0.0.1:8888` (login) — copy its Client ID + Secret.
2. **Twitch**: register a **Public** app at [dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps)
   with redirect URL `http://localhost:43111` — copy its Client ID.
3. Put them in `app-config.json`, build, and share the files from `release/`.

Your users then only: install → **Connect Spotify** → **Connect Twitch** → create the reward.

Caveats when sharing:

- **Spotify's 25-user limit**: a new Spotify app is in development mode, so each user must be
  added under the app's **User Management** page (name + their Spotify email). Request an
  extension from the dashboard for more.

- The installers are not code-signed, so Windows SmartScreen shows "unknown publisher"
  (More info → Run anyway) and macOS needs right-click → Open the first time. A code-signing
  certificate removes this but is optional.

## Stream audio

Spotify (and SongSeek's YouTube/SoundCloud playback) are normal desktop audio, so OBS's
**Desktop Audio** captures them automatically. To keep music on its own mixer track, route
them through a virtual audio device (VoiceMeeter / VB-Cable on Windows, BlackHole on macOS).

There's also a **now-playing overlay** for OBS — see Settings → Stream overlay (OBS) for a
Browser Source link (`http://127.0.0.1:43112/overlay`).

## How requests are resolved

1. Direct links (`open.spotify.com/track/…`, `youtu.be/…`, `soundcloud.com/…`) play on that
   platform.
2. Free text is searched **Spotify → YouTube → SoundCloud**; the first hit is queued.

---

## Notes & limitations

- **Spotify Premium required**, and the Spotify app must be open and playing.
- YouTube plays as audio (resolved with bundled yt-dlp), so videos that block embedding
  still work.
- YouTube/SoundCloud search use those sites' public web endpoints; if a site changes its
  markup, search for that source may need a patch — direct links always work.
- The macOS build is unsigned (fine for personal testing — right-click → Open the first time).
