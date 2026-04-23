#!/usr/bin/env bash
# Spawns an Opus claude session to review + fix the merged Dispatch phases.
# Runs in parallel with the main orchestrator; targets a separate worktree so
# no conflicts.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/lib.sh"

REPO=/Users/home/src/Dispatch
WT=/Users/home/src/Dispatch-wt-review
BRANCH=review/post-merge-fixes
LOG=/tmp/dispatch-review.log

notify_log info "🔍 Review opus starting at $(date)"

# Setup worktree (idempotent)
if [[ ! -d "$WT" ]]; then
  git -C "$REPO" fetch origin main --quiet
  git -C "$REPO" branch -D "$BRANCH" 2>/dev/null
  if ! git -C "$REPO" worktree add -B "$BRANCH" "$WT" origin/main 2>>"$BUILD_LOG"; then
    notify_log error "Review: worktree create failed"
    exit 1
  fi
  notify_log info "Review: worktree created at $WT on $BRANCH"
fi

cd "$WT"

if [[ ! -d node_modules ]] || [[ "package.json" -nt node_modules/.package-lock.json ]]; then
  notify_log info "Review: npm install"
  npm install --silent >>"$BUILD_LOG" 2>&1 || notify_log warn "Review: npm install warnings"
fi

PROMPT=$(cat <<EOF
You are the autonomous post-merge reviewer for Dispatch. Read and follow exactly:
  /Users/home/src/Dispatch/docs/CLAUDE.md
  /Users/home/src/Dispatch/docs/review-brief.md

You work in ${WT} on branch ${BRANCH}. The orchestrator is running Phase 3+4 in
/Users/home/src/Dispatch-wt-3 and /Users/home/src/Dispatch-wt-4 — DO NOT touch those.

Use extended thinking. Delegate mechanical work to Haiku subs, implementation to Sonnet
subs, architectural / design-judgment calls to Opus subs.

Start with pass 1 (Phases 1, 6, 2, 5 that already merged). Open its PR, merge it.
Then poll for Phases 3 + 4 merge (up to 4 hours) and do pass 2.

Send iMessage via /Users/home/src/Dispatch/scripts/notify.sh at each pass completion.

Go.
EOF
)

claude \
  --model opus \
  --effort max \
  --permission-mode bypassPermissions \
  --add-dir /Users/home/src/Dispatch \
  --fallback-model sonnet \
  --output-format text \
  -p "$PROMPT" \
  >> "$LOG" 2>&1

EXIT_CODE=$?
notify_log info "Review opus exited $EXIT_CODE"

if [[ $EXIT_CODE -eq 0 ]]; then
  "$HERE/notify.sh" "🔍 Review opus finished cleanly. See PRs at github.com/4Gaige/Dispatch/pulls"
else
  "$HERE/notify.sh" "⚠️ Review opus exited $EXIT_CODE — see /tmp/dispatch-review.log"
fi
