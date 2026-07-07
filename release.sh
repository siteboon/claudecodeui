#!/usr/bin/env bash
set -euo pipefail

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

if ! npm whoami >/dev/null 2>&1; then
  echo "npm is not authenticated. Run npm login before shipping." >&2
  exit 1
fi

if [ -z "${GITHUB_TOKEN:-}" ]; then
  echo "GITHUB_TOKEN is required for GitHub releases. Put it in .env or export it." >&2
  exit 1
fi

exec npx release-it "$@"
