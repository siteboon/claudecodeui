#!/usr/bin/env bash
# Reads event log, formats a summary SMS, sends via iMessage.
# Called at end of orchestrator (success or failure).
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/lib.sh"

if [[ ! -f "$EVENTS_LOG" ]]; then
  send_imessage "⚠️ Dispatch orchestrator finished but event log is missing. Check manually."
  exit 0
fi

# Counts
OK=$(grep -c '\[success\]' "$EVENTS_LOG" 2>/dev/null || echo 0)
WARN=$(grep -c '\[warn\]' "$EVENTS_LOG" 2>/dev/null || echo 0)
ERR=$(grep -c '\[error\]' "$EVENTS_LOG" 2>/dev/null || echo 0)

# Phase statuses
PHASE_STATUS=""
for p in 1 2 3 4 5 6; do
  # Did it succeed?
  if grep -q "Phase $p: PR merged" "$EVENTS_LOG"; then
    PHASE_STATUS+="Phase $p ✅ merged"$'\n'
  elif grep -q "Phase $p failed" "$EVENTS_LOG"; then
    PHASE_STATUS+="Phase $p ❌ FAILED"$'\n'
  elif grep -q "Phase $p: claude completed" "$EVENTS_LOG"; then
    PHASE_STATUS+="Phase $p ⏳ claude done, PR pending"$'\n'
  elif grep -q "Phase $p: starting" "$EVENTS_LOG"; then
    PHASE_STATUS+="Phase $p ⚠️ started but unfinished"$'\n'
  else
    PHASE_STATUS+="Phase $p ⚪ not run"$'\n'
  fi
done

# Health
HEALTH=""
if grep -q "Health check: site responding" "$EVENTS_LOG"; then
  HEALTH="✅ site live"
elif grep -q "Health check FAILED" "$EVENTS_LOG"; then
  HEALTH="❌ site NOT responding — rollback recommended"
else
  HEALTH="⚠️ health not checked"
fi

PUBLIC=""
if grep -q "Public URL live via Access" "$EVENTS_LOG"; then
  PUBLIC="🌐 https://claude.forgeurfuture.com ready"
elif grep -q "Public URL unexpected" "$EVENTS_LOG"; then
  PUBLIC="⚠️ public URL issues"
fi

# Durations and notable events
FIRST_TS=$(head -1 "$EVENTS_LOG" | awk '{print $1}' | tr -d '[]')
LAST_TS=$(tail -1 "$EVENTS_LOG" | awk '{print $1}' | tr -d '[]')

# Verdict
if [[ $ERR -gt 0 ]]; then
  VERDICT="⚠️ Dispatch build finished with $ERR error(s)"
else
  VERDICT="✅ Dispatch complete and live"
fi

# Assemble message
MSG=$(cat <<EOF
$VERDICT

$PHASE_STATUS
$HEALTH
$PUBLIC

Summary: $OK successes · $WARN warns · $ERR errors
PRs: https://github.com/4Gaige/Dispatch/pulls
Logs: /tmp/dispatch-build.log
EOF
)

send_imessage "$MSG"
echo "$MSG" >> "$BUILD_LOG"
echo "[$(date)] morning summary sent" >> "$BUILD_LOG"
