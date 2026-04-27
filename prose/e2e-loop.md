---
name: e2e-loop
kind: program
services: [preflight, george, linus, prime]
---

requires:
- target: one of "config" | "jorge" — which Pluto instance to run against. Defaults to "config". Never use "jorge" as primary; jorge is only a fallback when config is down.
- max-iterations (optional): integer cap on fix-smoke cycles. Defaults to 5.
- wall-clock-budget (optional): ISO-duration or human-readable max wall time. Defaults to "6h".

ensures:
- status-report: a structured summary of what shipped, what was deferred, and a Linus recommendation on next steps
- polish-backlog: a file in the prose run dir (`polish-backlog.md`) listing George findings that were deferred (unblock-with-note) for future polish work
- smoke-result: final smoke outcome — "green" | "red-with-note" | "red-blocked"

errors:
- target-down: the chosen Pluto instance is not active; the loop cannot proceed
- budget-exhausted: reached max-iterations or wall-clock limit before smoke went green; report documents remaining failures

invariants:
- NEVER mutate ~jorge/.cloudcli/auth.db — george and prime must assert the target URL belongs to @config (or the explicit target), not @jorge, before any write operations
- smoke assertions are DOM-only — never frame counts; the heartbeat (commit 85d371d) sends pings every ~25s and will pollute frame-counting assertions
- linus.triage is the sole gate between "george found a bug" and "prime patches it" — prime never self-selects what to fix
- real-claude-failure is valid signal — if spec 04 fails because `claude` subprocess errors, that is an environment finding (log it), not a GUI bug
- iteration counter and wall-clock budget are enforced by the VM, not the services — services return results; the VM decides whether to continue looping
- the loop body runs serially: smoke → george → linus.triage → prime.implement → re-smoke. No parallelism within an iteration.
- prime.implement follows Prime contract: he runs tests privately, never surfaces pass/fail counts or test diffs to the caller

strategies:
- if linus.triage marks all findings as "unblock-with-note": exit loop immediately with smoke-result="red-with-note", append findings to polish-backlog
- if linus.triage marks any finding as "block": hand to prime for a focused fix, then re-smoke; count this as one iteration
- if smoke goes green at any point: exit the loop, do not run more iterations even if budget remains
- if the same spec fails for two consecutive iterations with the same root cause: linus writes a deferred note and the loop exits rather than cycling indefinitely

### Execution

# Step 0: preflight — git hygiene and target-URL discovery
# Also verifies the target instance is alive before burning an iteration.
let pre = call preflight
  request: "e2e smoke loop against @<target>"

# Guard: target instance must be active
# The @config instance runs as systemd unit claudecodeui@config on Pluto.
# Check it before doing anything else.
let target-instance = target ?? "config"
let base-url = pre.target-url ?? "https://pluto.tail9a8d83.ts.net/<target-instance>/"

# Preflight does not check systemd directly; the VM checks it here via shell.
# If claudecodeui@config is not active, signal target-down.
let instance-active = shell: "systemctl is-active claudecodeui@<target-instance> 2>/dev/null || echo inactive"
if instance-active is "inactive":
  signal target-down with: "claudecodeui@<target-instance> is not active on Pluto. Start it with: sudo systemctl start claudecodeui@<target-instance>"

# Resolve budget
let max-iter = max-iterations ?? 5
let budget = wall-clock-budget ?? "6h"
let start-time = now()

# Loop state
let iteration = 0
let smoke-green = false
let polish-backlog = []

loop until smoke-green or iteration >= max-iter or elapsed(start-time) >= budget:
  set iteration = iteration + 1

  # Phase A: Run smoke suite against the target instance
  # On Pluto, set PLAYWRIGHT_BASE_URL so playwright.config.ts skips the webServer block
  # and hits the live tailnet instance directly.
  # PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH must be exported in the caller's
  # per-machine environment (memory/environment.md per CLAUDE.md convention).
  # On NixOS this is the Nix store path to a system chromium binary; on
  # standard Linux/macOS leave it unset so Playwright uses its bundled browser.
  let smoke-result-raw = shell: "PLAYWRIGHT_BASE_URL=<base-url> npm run e2e:smoke 2>&1"
  let smoke-exit-code = shell: "echo $?"

  # Parse outcomes from smoke output (each spec is ✓ pass or ✘ fail)
  let smoke-passed = smoke-exit-code is "0"

  if smoke-passed:
    set smoke-green = true
    break

  # Phase B: George triages the failing UI — real-user exploration
  # George does NOT run specs; he explores the live app as a user and documents findings.
  let george-findings = call george
    request: "Explore the claudecodeui app at <base-url>. Focus on stability: WS disconnects, lost input, crashes, white screens. The smoke suite found failures — investigate the areas the specs cover: auth flow, project rail, session history, message send/receive, and WS reconnect behaviour."
    target-url: base-url
    auth: "Single-user system. Register at /api/auth/register (POST {username, password}) if no user exists, else login at /api/auth/login. Use username=e2euser password=e2epassword1 on dev:test; use the @<target-instance> credentials on Pluto live instance."
    patch: null

  # Phase C: Linus triages George's findings
  let triage = call linus
    role: "triage"
    findings: george-findings.findings
    request: "Triage these findings from the e2e smoke loop. Mark stability-class issues (crashes, lost input, WS failures, auth regressions) as 'block'. Mark polish and cosmetic issues as 'unblock-with-note'."

  # Collect unblock-with-note findings into polish backlog
  for finding in triage.unblock-with-note-findings:
    append finding to polish-backlog

  # If nothing blocks, exit loop
  if triage.has-blockers is false:
    set smoke-green = false  # smoke was red, but linus says ship anyway
    break

  # Phase D: Prime patches blockers
  let patch = call prime
    role: "implement"
    request: "Fix the following stability blockers found in the e2e smoke loop for claudecodeui. Iterate until npm run e2e:smoke passes against dev:test."
    plan: triage.block-findings
    review: null

  # Linus reviews Prime's patch
  let linus-review = call linus
    role: "review"
    patch: patch
    request: "Review this patch for the e2e smoke loop blockers. Does it address the root cause? Is the diff minimal and safe to ship?"

  if linus-review.verdict is "reject":
    # One more round for prime (counted within the iteration budget)
    let patch2 = call prime
      role: "implement"
      request: "Revise the patch per Linus's review. Address: <linus-review.review>"
      plan: triage.block-findings
      review: linus-review

  # Re-smoke happens at the top of the loop on the next iteration

# Write polish backlog to run dir
write file ".prose/runs/e2e-loop-<run-id>/polish-backlog.md" with polish-backlog

# Build final status report
let final-smoke = if smoke-green then "green" else (if polish-backlog is empty then "red-blocked" else "red-with-note")

let rec = call linus
  role: "recommend"
  request: "Based on <iteration> iterations of the e2e smoke loop, smoke outcome '<final-smoke>', and the polish backlog, write a brief recommendation: should the team ship the current state, run another loop cycle, or defer to a focused fix session?"

return {
  status-report: {
    iterations-run: iteration,
    smoke-result: final-smoke,
    polish-backlog-path: ".prose/runs/e2e-loop-<run-id>/polish-backlog.md",
    linus-recommendation: rec,
    budget-remaining: budget-elapsed-fraction(start-time, budget),
  },
  smoke-result: final-smoke,
  polish-backlog: polish-backlog,
}
