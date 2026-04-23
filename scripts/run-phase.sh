#!/usr/bin/env bash
# run-phase.sh <phase_num> <branch_name>
# Assumes worktree has been pre-created by orchestrator.
# Invokes claude with a phase brief. Retries with commit-progress check + wall-clock deadline.
set -uo pipefail

PHASE="$1"
BRANCH="$2"
REPO=/Users/home/src/Dispatch
WT="${REPO}-wt-${PHASE}"

MAX_ATTEMPTS=${DISPATCH_MAX_ATTEMPTS:-3}
PHASE_DEADLINE=${DISPATCH_PHASE_DEADLINE:-5400}   # 90 minutes
PR_CI_WAIT=${DISPATCH_PR_CI_WAIT:-600}            # 10 minutes

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/lib.sh"

START_TS=$(date +%s)

notify_log info "Phase $PHASE: starting on $BRANCH in $WT (deadline ${PHASE_DEADLINE}s)"

# Verify worktree exists (orchestrator should have made it)
if [[ ! -d "$WT" ]]; then
  notify_log error "Phase $PHASE: worktree $WT does not exist; expected orchestrator to pre-create"
  exit 2
fi

cd "$WT"

# npm install idempotently (first time for this worktree)
if [[ ! -d node_modules ]] || [[ "package.json" -nt node_modules/.package-lock.json ]]; then
  notify_log info "Phase $PHASE: npm install"
  npm install --silent >>"$BUILD_LOG" 2>&1 || notify_log warn "Phase $PHASE: npm install warnings"
fi

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
3. Implement per the phase brief. COMMIT EARLY AND OFTEN so progress is preserved across retries.
4. Run \`npm run build\` to verify.
5. Run \`npm test\` if tests exist.
6. Spawn a fresh-eyes OPUS reviewer sub: new conversation, NO history of your work. Reviewer reads the git diff + CLAUDE.md + phase-${PHASE}-brief.md, answers the checklist in CLAUDE.md with YES/NO. Fix findings until all YES. Max 3 review-fix cycles.
$([[ "$PHASE" == "2" || "$PHASE" == "5" ]] && echo "7. ADDITIONAL: spawn a visual-review OPUS sub. This sub runs \`npm run dev\` in the background, uses Playwright to screenshot the changed pages at 375x812 (iPhone 14) and 1440x900 (desktop), saves to docs/screenshots/phase-${PHASE}/, opens docs/midnight/demo.html in Playwright for reference, and reports visual-language fidelity issues. Fix issues. Commit screenshots.")
8. Commit with conventional-commits messages. Subject MUST be lowercase after the type (e.g., \`feat: add sidebar tree\` NOT \`feat: Add Sidebar Tree\`). Body lines MUST be ≤100 chars.
9. Push branch: \`git push -u origin ${BRANCH}\`
10. Open PR: \`gh pr create --title "<lowercase conventional title>" --body "<summary, changes list, screenshots if phase 2 or 5, test results>" --base main\`
11. Wait for CI. Watch with \`gh pr checks --watch\`.
12. If green: \`gh pr merge --auto --squash --delete-branch\`.

Constraints:
- Never edit server/projects.js, server/index.js, or src/components/sidebar/subcomponents/SidebarProjectItem.tsx beyond a single require/import line per feature. Wrap in new files.
- Never raw Tailwind color classes. Only Midnight-mapped semantic shadcn vars or Midnight component classes.
- Mobile-first at 375x812; then scale up.
- Commit messages MUST satisfy the repo's commitlint rules. Test with \`git commit -m "..." --dry-run\` before real commits if unsure.

Go. Be thorough. No need to confirm with anyone — permissions are pre-granted.
EOF
}

build_recovery_prompt() {
  local attempt=$1
  cd "$WT"
  local git_status
  git_status=$(git status --short 2>&1 | head -40)
  local recent_commits
  recent_commits=$(git log --oneline origin/main..HEAD 2>&1 | head -10)
  [[ -z "$recent_commits" ]] && recent_commits="(no new commits yet on $BRANCH)"
  local open_prs
  open_prs=$(gh --repo 4Gaige/Dispatch pr list --head "$BRANCH" --state open --json number,title,state 2>&1 | head -5 || echo "(gh failed)")

  cat <<EOF
You are resuming Phase ${PHASE} of Dispatch (attempt ${attempt} of ${MAX_ATTEMPTS}). A previous attempt was interrupted or did not merge. DO NOT start from scratch — resume from current state.

Current worktree state:

GIT STATUS (uncommitted changes):
${git_status:-(clean)}

COMMITS ON ${BRANCH} (not yet on main):
${recent_commits}

OPEN PRs:
${open_prs:-(none)}

Your job:
1. Read /Users/home/src/Dispatch/docs/CLAUDE.md and /Users/home/src/Dispatch/docs/phase-${PHASE}-brief.md.
2. Assess what's left based on the state above.
3. Commit uncommitted changes if correct; revert only if clearly broken.
4. Complete remaining work → review → commit → push → PR → merge.

If the previous attempt pushed a branch but PR creation failed, try: \`gh pr create --base main\` again.
If a PR is open but CI is failing, read the CI output and fix.
If the branch has zero new commits, previous attempts made no real progress — start the work again but quickly.

Same constraints apply (additive patches, Midnight classes, mobile-first, lowercase commit subjects, body lines ≤100 chars).

Go.
EOF
}

count_new_commits() {
  git -C "$WT" fetch origin main --quiet 2>/dev/null
  git -C "$WT" rev-list --count "origin/main..HEAD" 2>/dev/null || echo 0
}

pr_merged() {
  gh --repo 4Gaige/Dispatch pr list --head "$BRANCH" --state merged --limit 1 --json number 2>/dev/null | grep -q '"number"'
}

pr_open() {
  gh --repo 4Gaige/Dispatch pr list --head "$BRANCH" --state open --limit 1 --json number 2>/dev/null | grep -q '"number"'
}

# ────────────────────────────────────────────────────────────────
# Retry loop
# ────────────────────────────────────────────────────────────────
attempt=1
while [[ $attempt -le $MAX_ATTEMPTS ]]; do

  # Deadline check
  elapsed=$(( $(date +%s) - START_TS ))
  if [[ $elapsed -gt $PHASE_DEADLINE ]]; then
    notify_log error "Phase $PHASE: wall-clock deadline exceeded (${elapsed}s > ${PHASE_DEADLINE}s); giving up"
    exit 1
  fi

  if [[ $attempt -eq 1 ]]; then
    PROMPT=$(build_fresh_prompt)
  else
    notify_log warn "Phase $PHASE: attempt $attempt (recovery prompt)"
    PROMPT=$(build_recovery_prompt "$attempt")
  fi

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
  notify_log info "Phase $PHASE attempt $attempt: claude exited $EXIT_CODE"

  # Already merged? ship it
  sleep 5
  if pr_merged; then
    notify_log success "Phase $PHASE: PR merged"
    exit 0
  fi

  # Commit-progress check: if attempt 1 produced zero new commits, fail fast.
  new_commits=$(count_new_commits)
  notify_log info "Phase $PHASE attempt $attempt: $new_commits new commit(s) on $BRANCH"
  if [[ $attempt -eq 1 && $new_commits -eq 0 ]]; then
    notify_log error "Phase $PHASE: attempt 1 produced zero commits; retry unlikely to help. Aborting."
    exit 1
  fi

  # Open PR but not merged? wait for CI
  if pr_open; then
    notify_log info "Phase $PHASE: PR open, waiting up to ${PR_CI_WAIT}s for CI + merge"
    timeout=$PR_CI_WAIT
    while [[ $timeout -gt 0 ]]; do
      sleep 30
      timeout=$((timeout - 30))
      if pr_merged; then
        notify_log success "Phase $PHASE: PR merged during CI wait"
        exit 0
      fi
      # Also check deadline during wait
      elapsed=$(( $(date +%s) - START_TS ))
      if [[ $elapsed -gt $PHASE_DEADLINE ]]; then
        notify_log error "Phase $PHASE: deadline exceeded during CI wait"
        exit 1
      fi
    done
    notify_log warn "Phase $PHASE: PR open but CI did not merge in time; trying recovery attempt"
  fi

  attempt=$((attempt + 1))
  sleep 10
done

notify_log error "Phase $PHASE: exhausted ${MAX_ATTEMPTS} attempts; giving up"
exit 1
