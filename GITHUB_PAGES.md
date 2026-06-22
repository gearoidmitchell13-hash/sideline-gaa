# Hosting SidelineGAA on GitHub Pages (free, permanent)

GitHub Pages gives the app a stable `https://<you>.github.io/<repo>/` address that never expires —
ideal once you're happy with it. The app already uses **relative paths**, so it works fine in a
sub-folder URL like that. (The empty `.nojekyll` file in this folder tells GitHub not to mangle the
files.)

You only need a free GitHub account. Two ways:

## A) All in the browser (no tools to install)
1. Go to <https://github.com/new>, create a repo called e.g. **`sideline-gaa`** (Public). Don't add
   a README. Click **Create repository**.
2. On the new repo page click **uploading an existing file**.
3. Open the **`SidelineGAA-PWA`** folder on your laptop and drag **all of its contents** (the files
   *inside* it — `index.html`, `app.js`, `stats.js`, `shotchart.js`, `styles.css`, `sw.js`,
   `manifest.webmanifest`, `.nojekyll`, and the `icons` folder) into the upload area.
4. Click **Commit changes**.
5. Go to **Settings → Pages**. Under *Build and deployment*, set **Source = Deploy from a branch**,
   **Branch = `main`**, **Folder = `/ (root)`**, then **Save**.
6. Wait ~1 minute, refresh the Pages settings page, and copy the published URL
   (`https://<you>.github.io/sideline-gaa/`).
7. On your **iPhone**, open that URL in **Safari** → **Share** → **Add to Home Screen**.

> Tip: make sure you upload the files that are *inside* `SidelineGAA-PWA`, not the folder itself,
> so `index.html` sits at the repo root.

## B) With Git on the command line
```bash
cd "SidelineGAA-PWA"
git init -b main
git add .
git commit -m "SidelineGAA PWA"
git remote add origin https://github.com/<you>/sideline-gaa.git
git push -u origin main
```
Then do step 5–7 above.

## Updating later
Re-upload the changed files (or `git push`) to the same repo. Pages redeploys automatically.
On the phone, the app picks up the new version on the next launch or two (the service worker
caches it). If it ever looks stale, remove it from the home screen and re-add it.

## Troubleshooting
- **Blank page / 404:** confirm `index.html` is at the repo root (not inside a sub-folder), and that
  Pages is set to the `main` branch + `/ (root)`.
- **Icon/styles missing:** the `icons` folder and `styles.css` must be uploaded too.
- **Not installing on iPhone:** you must open it in **Safari** (not Chrome/Gmail in-app browser).
