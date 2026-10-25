#!/usr/bin/env bash
# Narrow door from the Agent-Box (Hermes) to Workbench on the PC, over Tailscale.
# Verbs: sessions | usage [days] | projects | propose <projectId> <claude|codex> <title> | proposal <id>
# `propose` reads the prompt from stdin. A proposal only appears in Workbench; nothing runs until
# Kevin approves it there.
#
# Needs in the environment (for example ~/.hermes/.env, never printed or logged):
#   WORKBENCH_URL    e.g. http://100.x.y.z:3917   (the PC's Tailscale address)
#   WORKBENCH_TOKEN  a token created in Workbench -> Agent access (starts with wbk_)
set -euo pipefail

: "${WORKBENCH_URL:?WORKBENCH_URL is not set}"
: "${WORKBENCH_TOKEN:?WORKBENCH_TOKEN is not set}"
base="${WORKBENCH_URL%/}/api/workbench-agent"

call() {
  # --fail-with-body: show the server's error text on 4xx/5xx; the token is passed via a header file
  # on stdin so it never appears in the process list.
  printf 'header = "Authorization: Bearer %s"\n' "$WORKBENCH_TOKEN" |
    curl -sS --max-time 15 --fail-with-body -K - "$@"
}

verb="${1:-}"
case "$verb" in
  sessions) call "$base/sessions" ;;
  usage) call "$base/usage?days=${2:-30}" ;;
  projects) call "$base/projects" ;;
  proposal) call "$base/proposals/${2:?proposal id required}" ;;
  propose)
    project_id="${2:?projectId required}"
    agent="${3:?agent (claude|codex) required}"
    title="${4:?title required}"
    prompt="$(cat)"
    payload="$(jq -n --arg p "$project_id" --arg a "$agent" --arg t "$title" --arg r "$prompt" \
      '{projectId:$p, agent:$a, title:$t, prompt:$r}')"
    call -X POST -H 'Content-Type: application/json' --data "$payload" "$base/proposals"
    ;;
  *)
    echo "usage: workbench-feed {sessions|usage [days]|projects|propose <projectId> <agent> <title>|proposal <id>}" >&2
    exit 2
    ;;
esac
echo
