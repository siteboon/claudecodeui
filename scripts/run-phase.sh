#!/usr/bin/env bash
# run-phase.sh <phase_num> <branch_name>
# Creates a git worktree, invokes claude, retries with recovery context on failure.
set -uo pipefail

PHASE="$1"
BRANCH="$2"
REPO=/Users/home/src/Dispatch
WT="${REPO}-wt-${PHASE}"
MAX_ATTEMPTS=${DISPATCH_MAX_ATTEMPTS:-3}

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/lib.sh"

notify_log info "Phase $PHASE: starting on $BRANCH in $WT"

# Create worktree from main, branch if new (idempotent)
cd "$REPO"
git fetch origin main
if [[ ! -d "$WT" ]]; then
  git worktree add -B "$BRANCH" "$WT" origin/main 2>>"$BUILD_LOG" || {
    notify_log error "Phase $PHASE: worktree create failed"
    exit 2
  }
fi

cd "$WT"
# npm install idempotently
if [[ ! -d node_modules ]] || [[ "package.json" -nt node_modules ]]; then
  npm install --silent >>"$BUILD_LOG" 2>&1 || notify_log warn "Phase $PHASE: npm install warnings"
fi

# Build the phase prompt (pristine version)
build_fresh_prompt() {
  cat <<EOF
You are autonomous. You must complete Phase ${PHASE} of Dispatch without human intervention.

Read these files carefully before doing anything:
- /Users/home/src/Dispatch/docs/CLAUDE.md
- /Users/home/src/Dispatch/docs/build-plan.md
- /Users/home/src/Dispatch/docs/phase-${PHASE}-brief.md

Work in the current directory (${WT}) on branch ${BRANCH}.

Your workflow:
1. Plan your work. Use extended thinking.
2. Delegate: spawn Haiku subs for mechanical ops (grep/search/read), Sonnet subs for implementation + tests, Opus subs for architecture decisions only.
3. Implement per the phase brief.
4. Run \`npm run build\` to verify.
5. Run \`npm test\` if tests exist.
6. Spawn a fresh-eyes OPUS reviewer sub: new conversation, NO history of your work. Reviewer reads the git diff + CLAUDE.md + phase-${PHASE}-brief.md, answers the checklist in CLAUDE.md with YES/NO. Fix findings until all YES. Max 3 review-fix cycles.
$([[ "$PHASE" == "2" || "$PHASE" == "5" ]] && echo "7. ADDITIONAL: spawn a visual-review OPUS sub. This sub runs \`npm run dev\` in the background, uses Playwright to screenshot the changed pages at 375x812 (iPhone 14) and 1440x900 (desktop), saves to docs/screenshots/phase-${PHASE}/, opens docs/midnight/demo.html in Playwright for reference, and reports visual-language fidelity issues. Fix issues. Commit screenshots.")
8. Commit with conventional-commits messages (lowercase subject, body lines ≤100 chars).
9. Push branch: \`git push -u origin ${BRANCH}\`
10. Open PR: \`gh pr create --title "<conventional subject>" --body "<summary, changes list, screenshots if phase 2 or 5, test results>" --base main\`
11. Wait for CI. Watch with \`gh pr checks --watch\`.
12. If green: \`gh pr merge --auto --squash --delete-branch\`.
13. If stuck after 3 cycles: log full error + state to /tmp/dispatch-phase-${PHASE}.log and exit nonzero.

Constraints:
- Never edit server/projects.js, server/index.js, or src/components/sidebar/subcomponents/SidebarProjectItem.tsx beyond a single require/import line per feature. Wrap in new files.
- Never raw Tailwind color classes. Only Midnight-mapped semantic shadcn vars or Midnight component classes.
- Mobile-first at 375x812; then scale up.
- Commit messages MUST satisfy the repo's commitlint rules (lowercase subject after type, body lines ≤100 chars). Test one commit with \`git commit --dry-run\` if unsure.

Go. Be thorough. No need to confirm with anyone — permissions are pre-granted.
EOF
}

# Build a recovery prompt that tells claude to resume, not restart from scratch
build_recovery_prompt() {
  local attempt=$1
  cd "$WT"
  local git_status
  git_status=$(git status --short 2>&1 | head -40)
  local recent_commits
  recent_commits=$(git log --oneline -5 2>&1)
  local open_prs
  open_prs=$(gh pr list --head "$BRANCH" --state open 2>&1 | head -5 || echo "(gh pr list failed)")

  cat <<EOF
You are resuming Phase ${PHASE} of Dispatch. A previous attempt was interrupted (process killed, likely due to a hang or error). DO NOT start from scratch.

First, orient yourself to the current state:

GIT STATUS (uncommitted changes):
${git_status:-(clean)}

RECENT COMMITS on ${BRANCH}:
${recent_commits}

OPEN PRs on ${BRANCH}:
${open_prs:-(none)}

This is attempt ${attempt} of ${MAX_ATTEMPTS}.

Your job:
1. Read /Users/home/src/Dispatch/docs/CLAUDE.md and /Users/home/src/Dispatch/docs/phase-${PHASE}-brief.md if not already familiar.
2. Assess what's done vs. what's left based on the state above.
3. Continue from where the previous attempt stopped. Preserve existing uncommitted changes (commit them if they look correct, revert only if clearly broken).
4. Complete the remaining work, tests, review, commit, push, PR, merge.
5. Be efficient — this is a retry so avoid re-doing work already present in the git state.

Same constraints as the original brief apply (additive patches, Midnight classes, mobile-first, commitlint-compliant commits).

Go.
EOF
}

# Retry loop
attempt=1
while [[ $attempt -le $MAX_ATTEMPTS ]]; do
  if [[ $attempt -eq 1 ]]; then
    PROMPT=$(build_fresh_prompt)
  else
    notify_log warn "Phase $PHASE: attempt $attempt (recovering from previous exit)"
    PROMPT=$(build_recovery_prompt "$attempt")
  fi

  # Launch claude; its stdout/stderr to per-phase log
  claude \
    --model opus \
    --effort max \
    --permission-mode bypassPermissions \
    --add-dir /Users/home/src/Dispatch \
    --fallback-model sonnet \
    --output-format text \
    -p "$PROMPT" \
    >> "/tmp/dispatch-phase-${PHASE}.log" 2>&1

  EXIT_CODE=$?

  if [[ $EXIT_CODE -eq 0 ]]; then
    notify_log info "Phase $PHASE attempt $attempt: claude exited 0"
    # Verify PR actually merged (not just claude exit clean)
    sleep 8
    if gh -R 4Gaige/Dispatch pr list --head "$BRANCH" --state merged --limit 1 --json number 2>/dev/null | grep -q '"number"'; then
      notify_log success "Phase $PHASE: PR merged"
      exit 0
    elif gh -R 4Gaige/Dispatch pr list --head "$BRANCH" --state open --limit 1 --json number,statusCheckRollup 2>/dev/null | grep -q '"number"'; then
      notify_log warn "Phase $PHASE: PR open but not merged — waiting for CI"
      # Give CI up to 10 min to finish
      timeout=600
      while [[ $timeout -gt 0 ]]; do
        if gh -R 4Gaige/Dispatch pr list --head "$BRANCH" --state merged --limit 1 --json number 2>/dev/null | grep -q '"number"'; then
          notify_log success "Phase $PHASE: PR merged after wait"
          exit 0
        fi
        sleep 30
        timeout=$((timeout - 30))
      done
      notify_log warn "Phase $PHASE: PR open but CI/merge timed out; retrying"
    else
      notify_log warn "Phase $PHASE: claude exit 0 but no PR found; retrying"
    fi
  else
    notify_log error "Phase $PHASE attempt $attempt: claude failed (exit $EXIT_CODE)"
  fi

  attempt=$((attempt + 1))
  sleep 10
done

notify_log error "Phase $PHASE: exhausted ${MAX_ATTEMPTS} attempts; giving up"
exit 1
