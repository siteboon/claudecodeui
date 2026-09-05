#!/usr/bin/env bash
#
# safe-restart.sh — reload the cloudcli pm2 app without re-poisoning its environment.
#
#   cp plan/deploy-safe-restart.sh ~/.cloudcli/safe-restart.sh && chmod +x ~/.cloudcli/safe-restart.sh
#
# Why this exists
# ---------------
# `pm2 restart cloudcli` replays the environment pm2 saved in ~/.pm2/dump.pm2 and
# never re-reads ecosystem.config.js. That dump was written on 2026-08-25 by a
# `pm2 save` that ran from inside a Claude Code session, so it carries
# CLAUDE_CODE_CHILD_SESSION=1 plus a set of dead markers (CLAUDE_PID,
# CLAUDE_CODE_MESSAGING_SOCKET, AI_AGENT...). cloudcli passes its own environment
# verbatim to every PTY it spawns, so `claude` started from the Shell tab believes
# it is a child session and writes no transcript — unresumable, invisible in history.
#
# Modes
# -----
#   ./safe-restart.sh              reload ecosystem.config.js into the running app
#                                  (pm2 restart --update-env). Fixes the symptom;
#                                  the dead markers stay in the saved environment.
#   ./safe-restart.sh --recreate   delete and re-create the app from a scrubbed
#                                  environment. Also removes the dead markers.
#   ./safe-restart.sh --dry-run    print what would run, change nothing.
#   ./safe-restart.sh --yes        skip the confirmation prompt.
#   ./safe-restart.sh --force      run even from inside a Claude Code session.
#
# Either mode kills every live Claude session running through cloudcli.

set -euo pipefail

APP_NAME='cloudcli'
CONFIG="${CLOUDCLI_ECOSYSTEM:-$HOME/.cloudcli/ecosystem.config.js}"

# Markers a Claude Code session exports into its children. pm2 cannot unset a
# variable from the config file, so they are stripped here instead, at the point
# where pm2 captures the caller's environment.
SCRUB=(
  CLAUDE_CODE_CHILD_SESSION
  CLAUDE_CODE_SESSION_ID
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
)

SCRUB_ARGS=()
for var in "${SCRUB[@]}"; do SCRUB_ARGS+=(-u "$var"); done

RECREATE=0; DRY_RUN=0; ASSUME_YES=0; FORCE=0
for arg in "$@"; do
  case "$arg" in
    --recreate) RECREATE=1 ;;
    --dry-run)  DRY_RUN=1 ;;
    --yes|-y)   ASSUME_YES=1 ;;
    --force)    FORCE=1 ;;
    -h|--help)  sed -n '2,36p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

say()  { printf '%s\n' "$*"; }
step() { printf '\n\033[1m%s\033[0m\n' "$*"; }

run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '  would run: %s\n' "$*"
  else
    printf '  %s\n' "$*"
    "$@"
  fi
}

# --- guard: never restart from inside a Claude Code session -------------------
# It would kill this very session mid-script (possibly before `pm2 save`), and in
# --recreate mode the session's own markers are exactly what we are removing.
if [ -n "${CLAUDECODE:-}${CLAUDE_CODE_SESSION_ID:-}" ] && [ "$FORCE" -eq 0 ]; then
  cat >&2 <<'MSG'
Refusing to run: this shell is inside a Claude Code session.

Restarting cloudcli kills that session, possibly before this script finishes.
Run it from a plain SSH shell instead, or pass --force if you know what you are doing.
MSG
  exit 1
fi

[ -f "$CONFIG" ] || { echo "config not found: $CONFIG" >&2; exit 1; }

app_pid() {
  # Preferred: ask pm2. Falls back to a process scan when node is not on PATH
  # (a plain login shell may not have nvm sourced).
  local pid=''
  if command -v node >/dev/null 2>&1; then
    pid="$(pm2 jlist 2>/dev/null | node -e '
      let s = "";
      process.stdin.on("data", d => s += d).on("end", () => {
        try {
          const app = JSON.parse(s).find(a => a.name === "'"$APP_NAME"'");
          process.stdout.write(app && app.pid ? String(app.pid) : "");
        } catch { /* pm2 not running, or no such app */ }
      });' 2>/dev/null || true)"
  fi
  if [ -z "$pid" ]; then
    pid="$(pgrep -u "$(id -un)" -f "bin/$APP_NAME\$" 2>/dev/null | head -1 || true)"
  fi
  printf '%s' "$pid"
}

# --- what is about to die -----------------------------------------------------
step "Current state"
PID="$(app_pid)"
if [ -z "$PID" ]; then
  say "  $APP_NAME is not running under pm2."
else
  say "  $APP_NAME pid $PID"
  CHILDREN="$(pgrep -P "$PID" -a 2>/dev/null || true)"
  if [ -n "$CHILDREN" ]; then
    COUNT="$(printf '%s\n' "$CHILDREN" | grep -c . || true)"
    say "  $COUNT live child process(es) — these die on restart:"
    printf '%s\n' "$CHILDREN" | cut -c1-100 | sed 's/^/    /'
  else
    say "  no live child processes."
  fi
  if grep -qz 'CLAUDE_CODE_CHILD_SESSION=1' "/proc/$PID/environ" 2>/dev/null; then
    say "  ⚠ CLAUDE_CODE_CHILD_SESSION=1 is present in the running environment."
  fi
fi

# --- confirm ------------------------------------------------------------------
if [ "$DRY_RUN" -eq 0 ] && [ "$ASSUME_YES" -eq 0 ]; then
  MODE_LABEL=$([ "$RECREATE" -eq 1 ] && echo "DELETE and re-create" || echo "restart")
  printf '\nAbout to %s %s. Continue? [y/N] ' "$MODE_LABEL" "$APP_NAME"
  read -r reply
  case "$reply" in [yY]*) ;; *) echo "aborted."; exit 0 ;; esac
fi

# --- act ----------------------------------------------------------------------
step "Applying"
if [ "$RECREATE" -eq 1 ]; then
  run pm2 delete "$APP_NAME" || true
  run env "${SCRUB_ARGS[@]}" pm2 start "$CONFIG"
else
  # --update-env is what makes pm2 re-read the config; without it the saved
  # environment is replayed and the config file is ignored entirely.
  run env "${SCRUB_ARGS[@]}" pm2 restart "$CONFIG" --update-env
fi
run pm2 save

# --- verify -------------------------------------------------------------------
step "Verifying"
if [ "$DRY_RUN" -eq 1 ]; then
  say "  (dry run — nothing to verify)"
  exit 0
fi

sleep 2
NEW_PID="$(app_pid)"
if [ -z "$NEW_PID" ]; then
  say "  ✗ $APP_NAME is not running. Check: pm2 logs $APP_NAME --lines 50"
  exit 1
fi
say "  $APP_NAME pid $NEW_PID"

ENVIRON="/proc/$NEW_PID/environ"
check() {
  local var="$1" want="$2"   # want: present | absent
  if grep -qz "^$var=" "$ENVIRON" 2>/dev/null; then
    [ "$want" = present ] && say "  ✓ $var is set" || say "  ✗ $var is still set"
  else
    [ "$want" = absent ] && say "  ✓ $var is gone" || say "  ✗ $var is missing"
  fi
}

check CLAUDE_CODE_FORCE_SESSION_PERSISTENCE present
if [ "$RECREATE" -eq 1 ]; then
  check CLAUDE_CODE_CHILD_SESSION absent
  check CLAUDE_PID absent
else
  say "  · CLAUDE_CODE_CHILD_SESSION is expected to remain (pm2 cannot unset it);"
  say "    FORCE_SESSION_PERSISTENCE overrides it. Use --recreate to remove it."
fi

cat <<'MSG'

Next: start a session from the Shell tab, then confirm a new transcript appears:

  ls -lt ~/.claude/projects/<encoded-cwd>/*.jsonl | head -3

A fresh .jsonl means the marker is no longer suppressing transcript writes.
MSG
