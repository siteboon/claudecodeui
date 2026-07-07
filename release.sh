#!/usr/bin/env bash
set -euo pipefail

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

if [ -z "${GITHUB_TOKEN:-}" ]; then
  GITHUB_TOKEN="$(
    node <<'NODE'
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = process.env.DATABASE_PATH || path.join(os.homedir(), '.cloudcli', 'auth.db');
try {
  if (!fs.existsSync(dbPath)) process.exit(0);
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const row = db.prepare(`
    SELECT credential_value
    FROM user_credentials
    WHERE credential_type = 'github_token' AND is_active = 1
    ORDER BY created_at DESC
    LIMIT 1
  `).get();
  db.close();
  if (row?.credential_value) process.stdout.write(row.credential_value);
} catch {
  process.exit(0);
}
NODE
  )"
  export GITHUB_TOKEN
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
