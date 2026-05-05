# Rotation Planner

Mobile-first Progressive Web App for a Little League coach (Barnstable Minors, ages 8–12).
Vanilla HTML / CSS / JavaScript. localStorage. No frameworks. No build step. No CDN.

## Run locally

Serve the folder with any static-file HTTP server (a `file://` open will not register the service worker):

```sh
# Python 3 — works on macOS out of the box
cd /Users/sammazzeo/projects/rotation-planner
python3 -m http.server 8080
# then open http://localhost:8080/ in your browser
```

## Deploy to GitHub Pages

The repo target is `https://github.com/hellobirdieiq-cloud/rotation-planner.git`.
Deployed URL will be `https://hellobirdieiq-cloud.github.io/rotation-planner/`.

> **NOTE:** the build plan ships in phases. Stop after each phase for review before committing.

First-time deploy steps (for the developer to run, AFTER reviewing each phase):

```sh
# from /Users/sammazzeo/projects/rotation-planner
git init
git branch -M main
git add .gitignore
git add index.html manifest.webmanifest service-worker.js README.md
git add css/ js/ icons/
git commit -m "Phase 0: stub PWA + iPhone install"
git remote add origin https://github.com/hellobirdieiq-cloud/rotation-planner.git
git push -u origin main
```

Then on github.com:

1. Repo → Settings → Pages
2. Build and deployment → Source: **Deploy from a branch**
3. Branch: `main`, folder: `/ (root)` → Save
4. After ~30 seconds the live URL appears at the top of the Pages settings.

## Install on iPhone Safari

1. Open `https://hellobirdieiq-cloud.github.io/rotation-planner/` in Safari.
2. Tap the Share icon → **Add to Home Screen** → Add.
3. Open from your home screen — the app runs standalone (no Safari chrome).
4. Try airplane mode: the app still loads from cache.

## Install on Android Chrome

1. Open the URL in Chrome.
2. Three-dot menu → **Install app** → Install.
3. Open from your app drawer.

## File layout (Phase 0)

```
.
├── index.html
├── manifest.webmanifest
├── service-worker.js
├── README.md
├── .gitignore
├── css/app.css
├── js/app.js
└── icons/
    ├── icon-192.png
    ├── icon-512.png
    └── icon-maskable-512.png
```

`reference/` and `docs/` are gitignored — local-only inputs.

## Cache busting

To force every installed PWA to fetch fresh assets, bump `CACHE_NAME` at the top of `service-worker.js` (e.g., `rotation-planner-v0-2026-05-05` → `rotation-planner-v0-2026-05-06`). The next time the app opens with network, it activates the new cache and shows a "New version installed — reload to apply" toast.
