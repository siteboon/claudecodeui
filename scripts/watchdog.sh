#!/usr/bin/env bash
# Dispatch watchdog — observes autonomous build, intervenes only on CLEAR jams.
#
# Design principles:
#   1. Passive by default. Read-only observation.
#   2. Never interrupt active work. Multi-signal check (CPU + children + file writes) required.
#   3. Only intervene after STUCK_THRESHOLD seconds of sustained zero-activity.
#   4. Graceful kill: SIGTERM first, SIGKILL only if SIGTERM ignored.
#   5. Never touches worktree files directly — lets run-phase.sh retry handle recovery.
#   6. Logs everything; morning summary reflects interventions.

set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/lib.sh"

WATCHDOG_LOG=/tmp/dispatch-watchdog.log
STUCK_THRESHOLD=${DISPATCH_WATCHDOG_STUCK_THRESHOLD:-900}   # 15 minutes
POLL_INTERVAL=${DISPATCH_WATCHDOG_POLL_INTERVAL:-120}       # 2 minutes
ACTIVITY_WINDOW=${DISPATCH_WATCHDOG_ACTIVITY_WINDOW:-300}   # file-write window = 5 min

# Track when each phase first went idle (assoc array)
declare -A stuck_since

# Track PIDs we've already SIGTERM'd to avoid double-kill thrash
declare -A terminated

echo "[$(date)] watchdog started pid=$$ threshold=${STUCK_THRESHOLD}s poll=${POLL_INTERVAL}s" > "$WATCHDOG_LOG"

# ────────────────────────────────────────────────────────────────
# process_is_working <pid>
# Returns 0 if process is clearly doing work, 1 if idle/dead.
# Work signals (ANY of these → working):
#   - CPU > 0.5% averaged over 3 samples
#   - Has one or more child processes
#   - Has written a file in the corresponding worktree within ACTIVITY_WINDOW
# ────────────────────────────────────────────────────────────────
process_is_working() {
  local pid=$1
  local worktree=${2:-}

  # Dead?
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "dead"
    return 1
  fi

  # CPU over 3 samples (1s apart)
  local cpu_total=0
  for _ in 1 2 3; do
    local cpu
    cpu=$(ps -p "$pid" -o pcpu= 2>/dev/null | tr -d ' ' || echo 0)
    cpu_total=$(awk -v a="$cpu_total" -v b="$cpu" 'BEGIN { print a + b }')
    sleep 1
  done
  local cpu_avg
  cpu_avg=$(awk -v s="$cpu_total" 'BEGIN { printf "%.2f", s / 3 }')

  # Child count
  local kids
  kids=$(pgrep -P "$pid" 2>/dev/null | wc -l | tr -d ' ')

  # Recent worktree writes (non-dist, non-node_modules)
  local recent_writes=0
  if [[ -n "$worktree" && -d "$worktree" ]]; then
    recent_writes=$(find "$worktree" -type f \
      -not -path "*/node_modules/*" \
      -not -path "*/.git/*" \
      -not -path "*/dist-server/*" \
      -not -path "*/dist/*" \
      -newermt "$(date -v-${ACTIVITY_WINDOW}S +%Y-%m-%dT%H:%M:%S 2>/dev/null || date -d "-${ACTIVITY_WINDOW} seconds" +%Y-%m-%dT%H:%M:%S)" \
      2>/dev/null | wc -l | tr -d ' ')
  fi

  # Working if ANY positive signal
  if awk -v c="$cpu_avg" 'BEGIN { exit !(c > 0.5) }'; then
    echo "working (cpu=${cpu_avg}%)"
    return 0
  fi
  if [[ ${kids:-0} -gt 0 ]]; then
    echo "working (kids=${kids})"
    return 0
  fi
  if [[ ${recent_writes:-0} -gt 0 ]]; then
    echo "working (writes=${recent_writes})"
    return 0
  fi

  echo "idle (cpu=${cpu_avg}% kids=${kids} writes=${recent_writes})"
  return 1
}

# ────────────────────────────────────────────────────────────────
# intervene <phase> <pid>
# SIGTERM → wait 30s → SIGKILL if still alive.
# run-phase.sh will then detect the exit and retry (with recovery context).
# ────────────────────────────────────────────────────────────────
intervene() {
  local phase=$1
  local pid=$2

  # Double-guard: take a snapshot of state for the record
  local snap
  snap=$(ps -p "$pid" -o pid,state,etime,pcpu,command 2>/dev/null | head -3 || echo "(ps failed)")
  echo "[$(date)] INTERVENE phase=$phase pid=$pid state:" >> "$WATCHDOG_LOG"
  echo "$snap" >> "$WATCHDOG_LOG"

  notify_log warn "Watchdog: phase $phase process $pid appears hung ≥${STUCK_THRESHOLD}s, SIGTERM"

  kill -TERM "$pid" 2>/dev/null
  terminated[$pid]=$(date +%s)

  # Wait up to 30s for graceful exit
  for _ in $(seq 1 30); do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "[$(date)] phase=$phase pid=$pid exited after SIGTERM" >> "$WATCHDOG_LOG"
      notify_log info "Watchdog: phase $phase gracefully terminated"
      return
    fi
    sleep 1
  done

  # SIGTERM ignored — SIGKILL
  echo "[$(date)] phase=$phase pid=$pid SIGKILL (SIGTERM ignored)" >> "$WATCHDOG_LOG"
  notify_log warn "Watchdog: phase $phase SIGKILL (SIGTERM ignored)"
  kill -KILL "$pid" 2>/dev/null
}

# ────────────────────────────────────────────────────────────────
# Main poll loop
# ────────────────────────────────────────────────────────────────
while true; do
  # Is orchestrator still running? If not, exit watchdog too.
  if ! pgrep -f "scripts/orchestrator.sh" >/dev/null 2>&1; then
    echo "[$(date)] orchestrator gone, watchdog exiting" >> "$WATCHDOG_LOG"
    exit 0
  fi

  # For each phase worktree, find the claude process (if any) and assess
  for wt in /Users/home/src/Dispatch-wt-*; do
    [[ -d "$wt" ]] || continue
    phase=$(basename "$wt" | sed 's/Dispatch-wt-//')

    # Find top-level claude process with this phase in its argv
    claude_pid=$(pgrep -f "claude.*Phase ${phase} of Dispatch" 2>/dev/null | head -1)
    if [[ -z "$claude_pid" ]]; then
      # No claude running for this phase — maybe finished, maybe not started
      unset "stuck_since[$phase]" 2>/dev/null
      continue
    fi

    # Skip if we already terminated this PID (still winding down)
    if [[ -n "${terminated[$claude_pid]:-}" ]]; then
      continue
    fi

    status=$(process_is_working "$claude_pid" "$wt")
    echo "[$(date)] phase=$phase pid=$claude_pid $status" >> "$WATCHDOG_LOG"

    if [[ "$status" == working* ]]; then
      # Reset stuck timer
      unset "stuck_since[$phase]" 2>/dev/null
      continue
    fi

    # Idle — start or continue stuck timer
    if [[ -z "${stuck_since[$phase]:-}" ]]; then
      stuck_since[$phase]=$(date +%s)
      echo "[$(date)] phase=$phase entered idle state" >> "$WATCHDOG_LOG"
      continue
    fi

    elapsed=$(( $(date +%s) - stuck_since[$phase] ))
    echo "[$(date)] phase=$phase idle for ${elapsed}s (threshold ${STUCK_THRESHOLD}s)" >> "$WATCHDOG_LOG"

    if [[ $elapsed -ge $STUCK_THRESHOLD ]]; then
      intervene "$phase" "$claude_pid"
      unset "stuck_since[$phase]" 2>/dev/null
    fi
  done

  sleep "$POLL_INTERVAL"
done
