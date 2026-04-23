#!/usr/bin/env bash
# CLI wrapper around send_imessage for any script/phase to use.
# Usage: notify.sh "Your message here"
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/lib.sh"

if [[ $# -lt 1 ]]; then
  echo "usage: notify.sh <message>" >&2
  exit 1
fi

MESSAGE="$*"
send_imessage "$MESSAGE"
notify_log info "imessage sent: $MESSAGE"
