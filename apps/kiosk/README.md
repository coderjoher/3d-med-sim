# MedSim Lab — station kiosk shell

Locks a lab station to the MedSim Lab student app (PRD §12, R-09). The app itself is
served by the lab server at `/station`; this shell only provides the locked-down window.

Two options:

## 1. Tauri v2 shell (recommended)

`src-tauri/` holds a minimal Tauri v2 app:

- one window, **full screen, undecorated, always on top, not closable / minimisable /
  resizable**, hidden from the task bar, devtools and zoom hotkeys disabled
- closing (Alt+F4, window manager) is refused; focus is reclaimed if lost
- the web app's *Exit kiosk mode* dialog checks the proctor PIN and calls the
  `exit_kiosk` command (allowed for the lab-server origin via `capabilities/station.json`),
  which re-checks the PIN natively and quits
- the browser-level lockdown (blocked shortcuts, context menu, navigation guard) lives in
  the web app (`apps/web/src/station/Kiosk.tsx`) so it also works in the Chromium fallback

Runtime configuration (environment variables):

| Variable | Default | Purpose |
|---|---|---|
| `MEDSIM_STATION_URL` | `http://medsim-lab.local:3000/station` (in `tauri.conf.json`) | Station page on the lab server |
| `MEDSIM_STATION_ID` | — | Appended as `?station=<id>` (shown to the proctor) |
| `MEDSIM_PROCTOR_PIN` | `2468` | Proctor exit PIN; keep equal to the web build's `VITE_PROCTOR_PIN` |

Build on the target OS (needs Rust ≥ 1.77 and the platform webview: WebKitGTK 4.1 on
Linux, WebView2 on Windows):

```bash
cd apps/kiosk
npm install            # installs @tauri-apps/cli (not part of the root workspaces)
npm run build          # -> src-tauri/target/release/bundle/{deb,appimage,msi,nsis}
```

Edit the lab server host in `src-tauri/tauri.conf.json` (`app.windows[0].url`) and in
`src-tauri/capabilities/station.json` (`remote.urls`) before building, or set
`MEDSIM_STATION_URL` at launch. Regenerate icons with `npx tauri icon <logo.png>`.

**Camera permission:** WebView2 asks once per origin; pre-grant it for the lab server with
the Edge/WebView2 group policy `VideoCaptureAllowedUrls`. On Linux, WebKitGTK must be built
with media-stream (GStreamer) support.

Autostart: create a systemd user service / Windows scheduled task that runs the binary at
log-on of the dedicated station account; use the OS's kiosk / assigned-access mode for
full OS-level lockdown (Ctrl+Alt+Del, TTY switching cannot be blocked from user space).

> Not verifiable in the development container (no WebKitGTK); the config is validated
> against the Tauri v2 schema keys only.

## 2. Chromium kiosk fallback

```bash
apps/kiosk/scripts/launch-chromium-kiosk.sh http://medsim-lab.local:3000/station LAB-07
```

Runs Chromium/Chrome with `--kiosk`, a dedicated profile, no first-run / translate /
crash bubbles, swipe-navigation disabled, WebGPU enabled, and restarts the browser if it
exits. With write access to `/etc/chromium/policies/managed` it also installs a managed
policy that pre-allows the **real webcam** for the lab-server origin only and disables
devtools. Set `MEDSIM_NO_RESTART=1` to disable the restart loop.

## Offline / reliability

Stations keep working if the server drops (answers are queued in the station's
localStorage and synced to `POST /api/attempts/sync` when it returns). The MediaPipe
models are served by the lab server from `/mediapipe/` — run
`npm run fetch:vision -w apps/web` once before building the web app.
