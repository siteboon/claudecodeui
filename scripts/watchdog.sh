#!/usr/bin/env bash
# Dispatch watchdog — observes autonomous build, intervenes only on CLEAR jams.
#
# Anchors on the run-phase.sh wrapper process (stable, predictable argv) and inspects
# its claude child, not the claude argv itself (which has embedded newlines that break
# naive pgrep patterns).

set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/lib.sh"

WATCHDOG_LOG=/tmp/dispatch-watchdog.log
STUCK_THRESHOLD=${DISPATCH_WATCHDOG_STUCK_THRESHOLD:-900}   # 15 minutes
POLL_INTERVAL=${DISPATCH_WATCHDOG_POLL_INTERVAL:-120}       # 2 minutes
ACTIVITY_WINDOW=${DISPATCH_WATCHDOG_ACTIVITY_WINDOW:-300}   # 5 min file-write window

declare -A stuck_since
declare -A terminated

echo "[$(date)] watchdog started pid=$$ threshold=${STUCK_THRESHOLD}s poll=${POLL_INTERVAL}s" > "$WATCHDOG_LOG"

# ────────────────────────────────────────────────────────────────
# process_is_working <pid> <worktree>
# Returns 0 if the process is clearly doing work, 1 if idle/dead.
# ────────────────────────────────────────────────────────────────
process_is_working() {
  local pid=$1
  local worktree=${2:-}

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

  local kids
  kids=$(pgrep -P "$pid" 2>/dev/null | wc -l | tr -d ' ')

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
# ────────────────────────────────────────────────────────────────
intervene() {
  local phase=$1
  local pid=$2

  local snap
  snap=$(ps -p "$pid" -o pid,state,etime,pcpu,command 2>/dev/null | head -3 || echo "(ps failed)")
  echo "[$(date)] INTERVENE phase=$phase pid=$pid state:" >> "$WATCHDOG_LOG"
  echo "$snap" >> "$WATCHDOG_LOG"

  notify_log warn "Watchdog: phase $phase claude pid $pid appears hung ≥${STUCK_THRESHOLD}s, SIGTERM"
  kill -TERM "$pid" 2>/dev/null
  terminated[$pid]=$(date +%s)

  for _ in $(seq 1 30); do
    if ! kill -0 "$pid" 2>/dev/null; then
      notify_log info "Watchdog: phase $phase claude gracefully terminated"
      return
    fi
    sleep 1
  done

  notify_log warn "Watchdog: phase $phase claude SIGKILL (SIGTERM ignored)"
  kill -KILL "$pid" 2>/dev/null
}

# ────────────────────────────────────────────────────────────────
# Main poll loop
# Anchor on run-phase.sh wrappers; find their claude children.
# ────────────────────────────────────────────────────────────────
while true; do
  if ! pgrep -f "scripts/orchestrator.sh" >/dev/null 2>&1; then
    echo "[$(date)] orchestrator gone, watchdog exiting" >> "$WATCHDOG_LOG"
    exit 0
  fi

  # For each run-phase.sh wrapper
  while IFS= read -r rp_pid; do
    [[ -z "$rp_pid" ]] && continue

    # Extract phase number from argv (second positional arg after the script path)
    phase=$(ps -p "$rp_pid" -o args= 2>/dev/null | awk '{
      for (i = 1; i <= NF; i++) if ($i ~ /run-phase\.sh$/) { print $(i+1); exit }
    }')
    [[ -z "$phase" ]] && continue

    wt="/Users/home/src/Dispatch-wt-${phase}"

    # Find direct claude child of this run-phase.sh
    claude_pid=$(pgrep -P "$rp_pid" 2>/dev/null | while read -r p; do
      if ps -p "$p" -o comm= 2>/dev/null | grep -q "^claude"; then
        echo "$p"
        break
      fi
    done)

    if [[ -z "$claude_pid" ]]; then
      # No claude child right now — could be between attempts, or setting up.
      # We don't intervene here; run-phase.sh has its own deadline.
      unset "stuck_since[$phase]" 2>/dev/null
      continue
    fi

    if [[ -n "${terminated[$claude_pid]:-}" ]]; then
      continue
    fi

    status=$(process_is_working "$claude_pid" "$wt")
    echo "[$(date)] phase=$phase rp_pid=$rp_pid claude_pid=$claude_pid $status" >> "$WATCHDOG_LOG"

    if [[ "$status" == working* ]]; then
      unset "stuck_since[$phase]" 2>/dev/null
      continue
    fi

    # Idle — begin / continue stuck timer
    if [[ -z "${stuck_since[$phase]:-}" ]]; then
      stuck_since[$phase]=$(date +%s)
      continue
    fi

    elapsed=$(( $(date +%s) - stuck_since[$phase] ))
    echo "[$(date)] phase=$phase idle for ${elapsed}s (threshold ${STUCK_THRESHOLD}s)" >> "$WATCHDOG_LOG"

    if [[ $elapsed -ge $STUCK_THRESHOLD ]]; then
      intervene "$phase" "$claude_pid"
      unset "stuck_since[$phase]" 2>/dev/null
    fi
  done < <(pgrep -f "scripts/run-phase.sh" 2>/dev/null)

  sleep "$POLL_INTERVAL"
done
