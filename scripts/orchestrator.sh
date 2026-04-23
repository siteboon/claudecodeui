#!/usr/bin/env bash
# Orchestrates Dispatch phased build. Runs in background.
# Doesn't send per-event SMS (that'd wake the user). Accumulates events to log;
# sends one morning-summary SMS at the end (or on first failure that halts everything).
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/lib.sh"

REPO=/Users/home/src/Dispatch
START_TS=$(date +%s)

: > "$EVENTS_LOG"   # fresh events log for this run
notify_log info "🌙 Orchestrator started $(date)"

# ---------- Wave 1: Phase 1 solo ----------
notify_log info "Wave 1 starting: Phase 1 (Midnight skin)"
if ! "$HERE/run-phase.sh" 1 feat/midnight-skin; then
  notify_log error "Phase 1 failed; aborting subsequent waves"
  "$HERE/morning-summary.sh"
  exit 1
fi
notify_log success "Wave 1 complete"

# Pull merged phase 1 into the main worktree
cd "$REPO"
git fetch origin main
git checkout main
git pull --ff-only origin main
notify_log info "Main updated with Phase 1"

# ---------- Wave 2: Phases 2, 5, 6 parallel ----------
notify_log info "Wave 2 starting: Phases 2, 5, 6 in parallel"
"$HERE/run-phase.sh" 2 feat/sidebar-tree &
PID2=$!
"$HERE/run-phase.sh" 5 feat/preview-chrome-worktrees &
PID5=$!
"$HERE/run-phase.sh" 6 feat/mcp-integrations &
PID6=$!

FAIL=0
wait $PID2 || { notify_log error "Phase 2 failed"; FAIL=1; }
wait $PID5 || { notify_log error "Phase 5 failed"; FAIL=1; }
wait $PID6 || { notify_log error "Phase 6 failed"; FAIL=1; }

if [[ $FAIL -eq 1 ]]; then
  notify_log error "Wave 2 had failures; attempting to continue with what merged"
fi

cd "$REPO"
git fetch origin main
git checkout main
git pull --ff-only origin main
notify_log info "Main updated after Wave 2"

# ---------- Wave 3: Phases 3 + 4 sequential ----------
notify_log info "Wave 3 starting: Phase 3 (auto-naming)"
if ! "$HERE/run-phase.sh" 3 feat/auto-naming; then
  notify_log error "Phase 3 failed"
  "$HERE/morning-summary.sh"
  exit 1
fi

cd "$REPO"
git fetch origin main
git checkout main
git pull --ff-only origin main

notify_log info "Wave 3 continuing: Phase 4 (topics)"
if ! "$HERE/run-phase.sh" 4 feat/topics; then
  notify_log error "Phase 4 failed"
  "$HERE/morning-summary.sh"
  exit 1
fi

cd "$REPO"
git fetch origin main
git checkout main
git pull --ff-only origin main

# ---------- Deploy to launchd ----------
notify_log info "Restarting launchd service to pick up new build"
launchctl kickstart -k "gui/$UID/com.cloudcli.server" 2>/dev/null || {
  notify_log warn "launchctl kickstart failed; try manual"
}
sleep 8

# Health check
if curl -sf http://localhost:3001 >/dev/null; then
  notify_log success "Health check: site responding on :3001"
else
  notify_log error "Health check FAILED — site not responding; consider rollback"
fi

# Cloudflare Access check
if curl -s -o /dev/null -w "%{http_code}" https://claude.forgeurfuture.com | grep -q "302\|200"; then
  notify_log success "Public URL live via Access"
else
  notify_log warn "Public URL unexpected response"
fi

END_TS=$(date +%s)
DURATION=$(( (END_TS - START_TS) / 60 ))
notify_log success "🎉 Orchestrator complete in ${DURATION} minutes"

"$HERE/morning-summary.sh"
