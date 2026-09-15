#!/usr/bin/env bash
#
# start-dev.sh — start (or reload) the second cloudcli instance, `cloudcli-dev`.
#
#   cp plan/deploy-start-dev.sh ~/.cloudcli/start-dev.sh && chmod +x ~/.cloudcli/start-dev.sh
#
# Why this exists
# ---------------
# pm2 captures the environment of whoever calls it. Started from inside a Claude
# Code session — which is where this checkout is usually worked on — the new app
# would inherit that session's markers: CLAUDE_CODE_CHILD_SESSION=1 (every PTY it
# spawns then writes no transcript), a CLAUDE_CODE_MESSAGING_SOCKET pointing at a
# session that will outlive it, and PORT/DATABASE_PATH aimed at the LIVE instance
# this one is meant to stay away from. They are stripped here, at the only point
# where that is possible.
#
# It never names the live `cloudcli` app. Restarting that one kills every Claude
# session running through it, including the one likely running this script.
#
#   ./start-dev.sh             start, or reload if already running
#   ./start-dev.sh --dry-run   print what would run, change nothing

set -euo pipefail

APP=cloudcli-dev
CONFIG="${CLOUDCLI_DEV_CONFIG:-$HOME/.cloudcli/ecosystem.dev.config.js}"
DEV_DB="${CLOUDCLI_DEV_DB:-$HOME/.cloudcli/auth-dev.db}"
CHECKOUT="${CLOUDCLI_DEV_CHECKOUT:-$HOME/work/claudecodeui}"

DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

# Same list as safe-restart.sh, plus the two that would point this instance back
# at the live one. pm2 cannot unset a variable from the config file.
SCRUB=(
  CLAUDE_CODE_CHILD_SESSION
  CLAUDE_CODE_SESSION_ID
  CLAUDE_CODE_SESSION_ATTENDED
  CLAUDE_CODE_ENTRYPOINT
  CLAUDE_CODE_MESSAGING_SOCKET
  CLAUDE_CODE_MESSAGING_TOKEN
  CLAUDE_CODE_SSE_PORT
  CLAUDE_CODE_EXECPATH
  CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS
  CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS
  CLAUDE_PID
  CLAUDE_EFFORT
  CLAUDECODE
  CLAUDE_AGENT_SDK_VERSION
  AI_AGENT
  PORT
  DATABASE_PATH
)

SCRUB_ARGS=()
for var in "${SCRUB[@]}"; do SCRUB_ARGS+=(-u "$var"); done

run() {
  if (( DRY_RUN )); then printf '  would run: %s\n' "$*"; else "$@"; fi
}

[[ -f "$CONFIG" ]] || { echo "missing config: $CONFIG" >&2; exit 1; }
[[ -f "$DEV_DB"  ]] || { echo "missing dev database: $DEV_DB" >&2; exit 1; }

# dist/ is what the server actually serves; a stale one silently tests old code.
if [[ -f "$CHECKOUT/dist/index.html" ]]; then
  newest_src=$(find "$CHECKOUT/src" -type f -newer "$CHECKOUT/dist/index.html" -print -quit 2>/dev/null || true)
  if [[ -n "$newest_src" ]]; then
    echo "WARNING: dist/ is older than $newest_src" >&2
    echo "         run 'npm run build' first, or you are testing stale code." >&2
  fi
else
  echo "missing $CHECKOUT/dist — run 'npm run build' first" >&2
  exit 1
fi

if pm2 describe "$APP" >/dev/null 2>&1; then
  echo "reloading $APP from $CONFIG"
  run env "${SCRUB_ARGS[@]}" pm2 restart "$CONFIG" --update-env
else
  echo "starting $APP from $CONFIG"
  run env "${SCRUB_ARGS[@]}" pm2 start "$CONFIG"
fi

if (( ! DRY_RUN )); then
  echo
  echo "Deliberately not running 'pm2 save' — a save from inside a Claude session"
  echo "is what froze CLAUDE_CODE_CHILD_SESSION into the live app's environment on"
  echo "2026-08-25. Run it yourself if you want cloudcli-dev to survive a reboot."
fi
