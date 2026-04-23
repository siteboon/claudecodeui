#!/usr/bin/env bash
# Orchestrates Dispatch phased build. Runs in background.
# Idempotent: skips phases with an already-merged PR.
# Serializes the race-prone `git worktree add` step; phase workers run in parallel after setup.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/lib.sh"

REPO=/Users/home/src/Dispatch
START_TS=$(date +%s)

: > "$EVENTS_LOG"   # fresh events log for this run
notify_log info "🌙 Orchestrator started $(date)"

# ────────────────────────────────────────────────────────────────
# phase_already_merged <branch>
# Returns 0 if a merged PR exists for this branch
# ────────────────────────────────────────────────────────────────
phase_already_merged() {
  local branch=$1
  gh --repo 4Gaige/Dispatch pr list --head "$branch" --state merged --limit 1 --json number 2>/dev/null | grep -q '"number"'
}

# ────────────────────────────────────────────────────────────────
# ensure_worktree <phase> <branch>
# Idempotently create the worktree. Serialize callers (caller responsibility).
# ────────────────────────────────────────────────────────────────
ensure_worktree() {
  local phase=$1
  local branch=$2
  local wt="${REPO}-wt-${phase}"

  if [[ -d "$wt" ]]; then
    return 0
  fi

  # Delete any dangling ref to the branch first (in case of a previous abort)
  git -C "$REPO" branch -D "$branch" 2>/dev/null

  # Fetch fresh main to base off of
  git -C "$REPO" fetch origin main --quiet

  if ! git -C "$REPO" worktree add -B "$branch" "$wt" origin/main 2>>"$BUILD_LOG"; then
    notify_log error "Phase $phase: worktree create failed (branch=$branch)"
    return 1
  fi
  notify_log info "Phase $phase: worktree created at $wt on $branch"
  return 0
}

# ────────────────────────────────────────────────────────────────
# run_phase_with_guard <phase> <branch>
# Skip if already merged; otherwise invoke run-phase.sh
# ────────────────────────────────────────────────────────────────
run_phase_with_guard() {
  local phase=$1
  local branch=$2

  if phase_already_merged "$branch"; then
    notify_log success "Phase $phase: already merged on $branch, skipping"
    return 0
  fi

  "$HERE/run-phase.sh" "$phase" "$branch"
}

# ────────────────────────────────────────────────────────────────
# deploy_and_check
# Restart launchd service + health check
# ────────────────────────────────────────────────────────────────
deploy_and_check() {
  notify_log info "Restarting launchd service to pick up new build"
  launchctl kickstart -k "gui/$UID/com.cloudcli.server" 2>/dev/null || notify_log warn "launchctl kickstart failed"
  sleep 8
  if curl -sf http://localhost:3001 >/dev/null; then
    notify_log success "Health check: site responding on :3001"
  else
    notify_log error "Health check FAILED — site not responding"
  fi
  if curl -s -o /dev/null -w "%{http_code}" https://claude.forgeurfuture.com | grep -q "302\|200"; then
    notify_log success "Public URL live via Access"
  else
    notify_log warn "Public URL unexpected response"
  fi
}

# ────────────────────────────────────────────────────────────────
# Wave 1 — Phase 1 solo
# ────────────────────────────────────────────────────────────────
notify_log info "Wave 1 starting: Phase 1 (Midnight skin)"
if phase_already_merged feat/midnight-skin; then
  notify_log success "Phase 1: already merged, skipping"
else
  if ! ensure_worktree 1 feat/midnight-skin; then
    "$HERE/morning-summary.sh"
    exit 1
  fi
  if ! run_phase_with_guard 1 feat/midnight-skin; then
    notify_log error "Phase 1 failed; aborting"
    "$HERE/morning-summary.sh"
    exit 1
  fi
fi
notify_log success "Wave 1 complete"

git -C "$REPO" fetch origin main --quiet && git -C "$REPO" checkout main --quiet && git -C "$REPO" pull --ff-only origin main --quiet
notify_log info "Main updated after Wave 1"

# ────────────────────────────────────────────────────────────────
# Wave 2 — Phases 2, 5, 6 parallel (worktrees pre-created serially)
# ────────────────────────────────────────────────────────────────
notify_log info "Wave 2 starting: creating worktrees serially"
wave2_ok=true
if ! phase_already_merged feat/sidebar-tree;              then ensure_worktree 2 feat/sidebar-tree              || wave2_ok=false; fi
if ! phase_already_merged feat/preview-chrome-worktrees;  then ensure_worktree 5 feat/preview-chrome-worktrees  || wave2_ok=false; fi
if ! phase_already_merged feat/mcp-integrations;          then ensure_worktree 6 feat/mcp-integrations          || wave2_ok=false; fi

if $wave2_ok; then
  notify_log info "Wave 2 worktrees ready; launching phase workers in parallel"
else
  notify_log warn "Wave 2 had worktree-create failures; launching whatever succeeded"
fi

# Launch the phase workers; each skips work if its branch is already merged
run_phase_with_guard 2 feat/sidebar-tree              &
PID2=$!
run_phase_with_guard 5 feat/preview-chrome-worktrees  &
PID5=$!
run_phase_with_guard 6 feat/mcp-integrations          &
PID6=$!

W2_FAIL=0
wait $PID2 || { notify_log error "Phase 2 failed"; W2_FAIL=1; }
wait $PID5 || { notify_log error "Phase 5 failed"; W2_FAIL=1; }
wait $PID6 || { notify_log error "Phase 6 failed"; W2_FAIL=1; }

if [[ $W2_FAIL -eq 1 ]]; then
  notify_log warn "Wave 2 had failures; continuing to Wave 3 with what merged"
fi

git -C "$REPO" fetch origin main --quiet && git -C "$REPO" checkout main --quiet && git -C "$REPO" pull --ff-only origin main --quiet
notify_log info "Main updated after Wave 2"

# ────────────────────────────────────────────────────────────────
# Wave 3 — Phase 3 then Phase 4 (sequential, P4 depends on P3)
# ────────────────────────────────────────────────────────────────
notify_log info "Wave 3 starting: Phase 3 (auto-naming)"
if phase_already_merged feat/auto-naming; then
  notify_log success "Phase 3: already merged, skipping"
else
  if ! ensure_worktree 3 feat/auto-naming; then
    notify_log error "Phase 3 worktree failed; aborting Wave 3"
    "$HERE/morning-summary.sh"
    exit 1
  fi
  if ! run_phase_with_guard 3 feat/auto-naming; then
    notify_log error "Phase 3 failed"
    "$HERE/morning-summary.sh"
    exit 1
  fi
fi

git -C "$REPO" fetch origin main --quiet && git -C "$REPO" checkout main --quiet && git -C "$REPO" pull --ff-only origin main --quiet

notify_log info "Wave 3 continuing: Phase 4 (topics)"
if phase_already_merged feat/topics; then
  notify_log success "Phase 4: already merged, skipping"
else
  if ! ensure_worktree 4 feat/topics; then
    notify_log error "Phase 4 worktree failed"
    "$HERE/morning-summary.sh"
    exit 1
  fi
  if ! run_phase_with_guard 4 feat/topics; then
    notify_log error "Phase 4 failed"
    "$HERE/morning-summary.sh"
    exit 1
  fi
fi

git -C "$REPO" fetch origin main --quiet && git -C "$REPO" checkout main --quiet && git -C "$REPO" pull --ff-only origin main --quiet

# ────────────────────────────────────────────────────────────────
# Deploy + final summary
# ────────────────────────────────────────────────────────────────
deploy_and_check

END_TS=$(date +%s)
DURATION=$(( (END_TS - START_TS) / 60 ))
notify_log success "🎉 Orchestrator complete in ${DURATION} minutes"

"$HERE/morning-summary.sh"
