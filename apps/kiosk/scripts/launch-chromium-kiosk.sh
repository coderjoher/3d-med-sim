#!/usr/bin/env bash
# Fallback kiosk launcher (R-09) for lab stations without the Tauri shell.
# Opens the station page in Chromium/Chrome kiosk mode with a dedicated profile.
# The real webcam is used (no fake devices); camera permission is pre-granted for the
# lab server origin through the managed-policy file below, so students never see a prompt.
#
# Usage: launch-chromium-kiosk.sh [STATION_URL] [STATION_ID]
#   STATION_URL defaults to $MEDSIM_STATION_URL or http://medsim-lab.local:3000/station
#   STATION_ID  defaults to $MEDSIM_STATION_ID or the host name
set -euo pipefail

URL="${1:-${MEDSIM_STATION_URL:-http://medsim-lab.local:3000/station}}"
STATION_ID="${2:-${MEDSIM_STATION_ID:-$(hostname -s)}}"
case "$URL" in *\?*) FULL_URL="$URL&station=$STATION_ID" ;; *) FULL_URL="$URL?station=$STATION_ID" ;; esac
ORIGIN="$(printf '%s' "$URL" | sed -E 's#^(https?://[^/]+).*#\1#')"

BROWSER="${CHROMIUM_BIN:-}"
if [ -z "$BROWSER" ]; then
  for b in chromium chromium-browser google-chrome-stable google-chrome; do
    if command -v "$b" >/dev/null 2>&1; then BROWSER="$(command -v "$b")"; break; fi
  done
fi
[ -n "$BROWSER" ] || { echo "Chromium/Chrome not found (set CHROMIUM_BIN)" >&2; exit 1; }

PROFILE="${MEDSIM_PROFILE_DIR:-$HOME/.medsim-kiosk-profile}"
mkdir -p "$PROFILE"

# Camera auto-allow for the lab server only (needs root once; ignored otherwise).
for POLICY_DIR in /etc/chromium/policies/managed /etc/opt/chrome/policies/managed; do
  if [ -w "$(dirname "$POLICY_DIR")" ] || [ -w "$POLICY_DIR" ] 2>/dev/null; then
    mkdir -p "$POLICY_DIR"
    cat > "$POLICY_DIR/medsim.json" <<JSON
{
  "VideoCaptureAllowedUrls": ["$ORIGIN"],
  "AudioCaptureAllowed": false,
  "DeveloperToolsAvailability": 2,
  "IncognitoModeAvailability": 1,
  "BrowserGuestModeEnabled": false,
  "PasswordManagerEnabled": false,
  "TranslateEnabled": false,
  "PrintingEnabled": false,
  "DownloadRestrictions": 0
}
JSON
  fi
done

# Restart the browser if it is closed (only a proctor with OS access can stop this loop).
while true; do
  "$BROWSER" \
    --kiosk "$FULL_URL" \
    --app="$FULL_URL" \
    --user-data-dir="$PROFILE" \
    --no-first-run \
    --no-default-browser-check \
    --disable-translate \
    --disable-infobars \
    --disable-session-crashed-bubble \
    --disable-features=TranslateUI,OverscrollHistoryNavigation \
    --overscroll-history-navigation=0 \
    --disable-pinch \
    --noerrdialogs \
    --autoplay-policy=no-user-gesture-required \
    --enable-features=Vulkan,WebGPU \
    --ignore-gpu-blocklist \
    --check-for-update-interval=31536000 || true
  [ "${MEDSIM_NO_RESTART:-0}" = "1" ] && break
  sleep 2
done
