# SidelineGAA — installable web app (PWA)

A full GAA stats tracker you can **install on your iPhone with no Mac and no App Store**.
It's a Progressive Web App: a web page that, once added to your home screen, runs full-screen,
works **offline**, and saves your teams and the in-progress match on the phone.

Everything from the prototype is here plus team/roster setup, a possession timer, a live-stats
screen, a full-time summary and **CSV export** — built on the 2026 (FRC) ruleset (two-pointers,
solo-and-go frees, the new kickout rules).

---

## Fastest way onto your iPhone (≈3 minutes, free)

You need to put this folder online once (a static web host). The easiest, account-light option:

### Option A — Netlify Drop (recommended)
1. On your **Windows laptop**, open <https://app.netlify.com/drop> in a browser.
2. Drag the **`SidelineGAA-PWA`** folder onto the page. It uploads and gives you an
   **`https://…netlify.app`** address.
3. On your **iPhone**, open that address **in Safari** (must be Safari, not Chrome).
4. Tap the **Share** button → **Add to Home Screen** → **Add**.
5. Launch it from the new **SidelineGAA** icon — it opens full-screen like an app and now works
   offline.

### Option B — GitHub Pages (permanent home)
A free, never-expiring `https://<you>.github.io/<repo>/` address. **See `GITHUB_PAGES.md` for
click-by-click steps** (browser-only or command line), then Add to Home Screen on your iPhone.

> **Why a host is needed:** iOS only enables offline mode + home-screen "app" behaviour when the
> page is served over **https**. Opening the file directly still works as a normal web page, but
> won't install or cache offline.

### Preview on your laptop first (optional)
In the `SidelineGAA-PWA` folder run a tiny local server and open it in your browser:
```
python -m http.server 8000
```
then visit <http://localhost:8000>. (Service worker / install only fully work over the hosted
https URL or localhost.)

---

## Using it

Open the app to a **home screen** — tap **New match** to set up a game, **Resume match** to continue one in progress, or **History & season**. The 🏠 button (top-left) returns home any time. There's a short splash on launch.

During a match the **clock at the top keeps running** (it's the match clock); the **possession** timer underneath pauses whenever the ball's out of play, which is what drives the possession %.

1. **Setup** — enter your team name, the opposition name, half length, and your starting 15's
   names (numbers are fixed 1–15). The opposition is tracked lighter — just jersey numbers. Tap
   **Start match**. Your squad is remembered for next time.
2. **Throw-in** — tap it, choose who won possession; the clock and possession timer start.
3. **Track** — the action bar shows only what can happen next: **Score / Wide / Free won /
   Turnover / Foul**. A score asks type (Point / **2-Point** / Goal) → scorer → source, then the
   **kickout sheet opens automatically**.
4. **Undo** rolls back the last event, or **tap any event in the feed** to fix its player or delete it (the score and possession re-derive automatically). **⋯** has substitution, half-time, pause and new match. The **screen stays awake** while a match is running, and discarding/ending a match asks for confirmation.
5. **Shot location** — after a score or wide, tap roughly where on the pitch it was taken (or
   **Skip**). These build the shot map.
6. **Live stats / full-time** — tap **Live stats** any time, or end the match for the full
   summary with a **shot chart** (toggle between teams), **Print / Save PDF** for a one-page
   report, and **Export CSV** of the raw events + stats (including shot X/Y).
   - **📈 Detailed stats** (button on the summary) breaks down scoring by source (play / frees /
     dead balls) and type, kickouts won/lost, a per-player table (points, shots, conversion,
     turnovers), and shot conversion by pitch zone (inside 20m / 20–40m / beyond the 40m arc).
7. **History & season** — finished matches are saved automatically. Open **History & season**
   from the start screen to see your record, points for/against, season top scorers, and to
   reopen or delete any past match.

## Your data
- Stored **only on your phone** (in the browser/app's local storage) — nothing is uploaded.
- The in-progress match auto-saves and **resumes** if you close and reopen.
- Clearing Safari website data, or deleting the home-screen app, clears saved teams/matches —
  export a CSV after each game to keep a permanent record.

## Updating the app
Re-deploy the folder to the same host (drag again on Netlify) and reopen it on your phone; the
service worker picks up the new version on the next launch or two.

## Files
```
SidelineGAA-PWA/
├─ index.html          screens (setup / live / summary / history) + shell
├─ styles.css          mobile-first styling, print CSS, safe-area aware
├─ app.js              core: state machine, live flow, timer, persistence
├─ stats.js            summary screen, stats engine, CSV export
├─ shotchart.js        shot-location capture + shot map
├─ history.js          saved matches + season aggregation
├─ detail.js           detailed stats (breakdowns, per-player, zones)
├─ live.js             wake lock + edit/delete events (score/possession recompute)
├─ sw.js               service worker (offline cache)
├─ manifest.webmanifest  app name, colours, icons, standalone display
└─ icons/             home-screen + maskable icons
```

## Roadmap (still on the list)
- Possession chains and richer Pro-mode detail.
- One-tap share of the CSV/report.
