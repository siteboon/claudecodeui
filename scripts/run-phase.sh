#!/usr/bin/env bash
# run-phase.sh <phase_num> <branch_name>
# Creates a git worktree, invokes claude in print mode with the phase brief, handles errors.
set -uo pipefail

PHASE="$1"
BRANCH="$2"
REPO=/Users/home/src/Dispatch
WT="${REPO}-wt-${PHASE}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/lib.sh"

notify_log info "Phase $PHASE: starting on $BRANCH in $WT"

# Create worktree from main, branch if new
cd "$REPO"
git fetch origin main
if [[ ! -d "$WT" ]]; then
  git worktree add -B "$BRANCH" "$WT" origin/main 2>>"$BUILD_LOG" || {
    notify_log error "Phase $PHASE: worktree create failed"
    exit 2
  }
fi

cd "$WT"
npm install --silent >>"$BUILD_LOG" 2>&1 || notify_log warn "Phase $PHASE: npm install warnings"

# Build the instruction prompt
PROMPT=$(cat <<EOF
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
${PHASE:+$( [[ "$PHASE" == "2" || "$PHASE" == "5" ]] && echo "7. ADDITIONAL: spawn a visual-review OPUS sub. This sub runs \`npm run dev\` in the background, uses Playwright to screenshot the changed pages at 375x812 (iPhone 14) and 1440x900 (desktop), saves to docs/screenshots/phase-${PHASE}/, opens docs/midnight/demo.html in Playwright for reference, and reports visual-language fidelity issues (shadows, blur, accents, touch targets, typography). Fix issues. Commit screenshots." )}
8. Commit with conventional-commits messages.
9. Push branch: \`git push -u origin ${BRANCH}\`
10. Open PR: \`gh pr create --title "<Phase ${PHASE}> <conventional title>" --body "<structured summary, changes list, screenshots if phase 2 or 5, test results>" --base main\`
11. Wait for CI. Watch with \`gh pr checks --watch\`.
12. If green: \`gh pr merge --auto --squash --delete-branch\`.
13. If stuck after 3 cycles: log full error + state to /tmp/dispatch-phase-${PHASE}.log and exit nonzero.

Constraints:
- Never edit server/projects.js, server/index.js, or src/components/sidebar/subcomponents/SidebarProjectItem.tsx beyond a single require/import line per feature (if even that). Wrap in new files.
- Never raw Tailwind color classes. Only Midnight-mapped semantic shadcn vars or Midnight component classes.
- Mobile-first at 375x812; then scale up.

Go. Be thorough. No need to confirm with anyone — permissions are pre-granted.
EOF
)

# Launch claude in non-interactive mode
claude \
  --model opus \
  --effort max \
  --permission-mode bypassPermissions \
  --add-dir /Users/home/src/Dispatch \
  --output-format text \
  -p "$PROMPT" \
  >> "/tmp/dispatch-phase-${PHASE}.log" 2>&1

EXIT_CODE=$?

if [[ $EXIT_CODE -eq 0 ]]; then
  notify_log success "Phase $PHASE: claude completed (exit 0)"
  # Verify merged
  sleep 5
  if gh -R 4Gaige/Dispatch pr list --head "$BRANCH" --state merged --limit 1 --json number 2>/dev/null | grep -q '"number"'; then
    notify_log success "Phase $PHASE: PR merged"
  else
    notify_log warn "Phase $PHASE: claude exited 0 but PR not merged; may be pending CI"
  fi
else
  notify_log error "Phase $PHASE: claude failed (exit $EXIT_CODE) — see /tmp/dispatch-phase-${PHASE}.log"
  exit $EXIT_CODE
fi
