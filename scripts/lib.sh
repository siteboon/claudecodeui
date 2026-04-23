#!/usr/bin/env bash
# Shared helpers for Dispatch orchestration.

BUILD_LOG=/tmp/dispatch-build.log
EVENTS_LOG=/tmp/dispatch-events.log
PHONE="+17023216697"

# notify_log <level> <message>
# levels: info, warn, error, success
# Appends to EVENTS_LOG with timestamp. Does NOT send SMS per event (that's morning-summary's job).
notify_log() {
  local level="$1"; shift
  local message="$*"
  local ts
  ts=$(date +"%Y-%m-%dT%H:%M:%S%z")
  echo "[$ts] [$level] $message" >> "$EVENTS_LOG"
  echo "[$ts] [$level] $message" >> "$BUILD_LOG"
}

# send_imessage <message>
# Sends via osascript to the user's phone. Silent failure if iMessage isn't set up.
send_imessage() {
  local message="$1"
  # Use the short form: address buddy via the iMessage service directly.
  # This avoids the "Can't get name of every account" error some macOS versions
  # throw on the longer form.
  local escaped
  escaped=$(printf '%s' "$message" | sed 's/"/\\"/g; s/\\/\\\\/g')
  osascript <<EOF 2>>"$BUILD_LOG" || echo "[imessage failure at $(date)]" >> "$BUILD_LOG"
tell application "Messages"
  send "$escaped" to buddy "$PHONE" of (service 1 whose service type is iMessage)
end tell
EOF
}

# send_sms_fallback — placeholder for future Twilio/other fallback
send_sms_fallback() {
  # If iMessage fails, we could ship this via a webhook to a SMS gateway.
  # Not implemented yet; iMessage should work on macOS.
  :
}

# summarize_log <path>
# Parses EVENTS_LOG, returns pretty summary for morning text.
summarize_log() {
  local log="$1"
  if [[ ! -f "$log" ]]; then
    echo "(no events logged)"
    return
  fi
  # Group by level, count
  awk -F'] \\[' '
    /\[info\]/    { info++ }
    /\[warn\]/    { warn++ }
    /\[error\]/   { err++ }
    /\[success\]/ { ok++ }
    END {
      printf "%d successes, %d info, %d warnings, %d errors\n", ok, info, warn, err
    }
  ' "$log"
}
