#!/usr/bin/env bash
# Dispatch auto-deploy watcher.
# Polls origin/main. When a new commit lands, rebuilds the fork + kickstarts the
# com.dispatch.forge launchd service so dispatch.forgeurfuture.com always serves
# the latest build. Safe to run alongside orchestrator / review opus — uses flock
# to serialize git + build operations on the main worktree.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/lib.sh"

REPO=/Users/home/src/Dispatch
POLL_INTERVAL=${DISPATCH_DEPLOY_POLL:-120}
DEPLOY_LOG=/tmp/dispatch-auto-deploy.log
LOCKFILE=/tmp/dispatch-main-worktree.lock

echo "[$(date)] auto-deploy started pid=$$ poll=${POLL_INTERVAL}s" > "$DEPLOY_LOG"
notify_log info "🚀 Auto-deploy watcher started"

# Baseline: current origin/main
git -C "$REPO" fetch origin main --quiet 2>/dev/null
last_sha=$(git -C "$REPO" rev-parse origin/main 2>/dev/null)
echo "[$(date)] baseline sha: $last_sha" >> "$DEPLOY_LOG"

# ────────────────────────────────────────────────────────────────
# deploy <new_sha> <old_sha>
# Pulls, (re)installs if package.json changed, builds, kickstarts service, health checks.
# Serialized via flock on $LOCKFILE so it doesn't race orchestrator/review pulls.
# ────────────────────────────────────────────────────────────────
deploy() {
  local new_sha=$1
  local old_sha=$2

  (
    # Serialize with orchestrator's main-worktree git ops
    flock -x 9 || exit 1

    echo "[$(date)] deploying $new_sha (from $old_sha)" >> "$DEPLOY_LOG"

    cd "$REPO"
    git checkout main --quiet 2>>"$DEPLOY_LOG"
    if ! git pull --ff-only origin main --quiet 2>>"$DEPLOY_LOG"; then
      notify_log error "Auto-deploy: git pull not fast-forward — manual intervention needed"
      return 1
    fi

    # npm install only if package.json or package-lock changed
    if git diff --name-only "$old_sha..$new_sha" 2>/dev/null | grep -qE "^package(-lock)?\.json$"; then
      echo "[$(date)] package.json changed; npm install" >> "$DEPLOY_LOG"
      if ! npm install --silent >>"$DEPLOY_LOG" 2>&1; then
        notify_log error "Auto-deploy: npm install failed for $new_sha"
        return 1
      fi
    fi

    # Build
    echo "[$(date)] running npm run build" >> "$DEPLOY_LOG"
    if ! npm run build >>"$DEPLOY_LOG" 2>&1; then
      notify_log error "Auto-deploy: build failed for ${new_sha:0:7}; previous build still serving on dispatch.forgeurfuture.com"
      return 1
    fi

    # Kickstart forge service (port 3002)
    echo "[$(date)] kickstarting com.dispatch.forge" >> "$DEPLOY_LOG"
    launchctl kickstart -k "gui/$UID/com.dispatch.forge" 2>>"$DEPLOY_LOG" || \
      notify_log warn "Auto-deploy: launchctl kickstart returned nonzero"

    sleep 6

    # Health check on port 3002
    if curl -sf http://localhost:3002 >/dev/null 2>&1; then
      local short_sha=${new_sha:0:7}
      local commit_msg
      commit_msg=$(git log -1 --format=%s "$new_sha" 2>/dev/null | head -c 100)
      notify_log success "Auto-deployed ${short_sha}: ${commit_msg}"
      "$HERE/notify.sh" "🚀 dispatch redeployed ${short_sha}: ${commit_msg}"
      return 0
    else
      notify_log error "Auto-deploy: health check failed on :3002 after rebuild"
      return 1
    fi
  ) 9>"$LOCKFILE"

  return $?
}

# ────────────────────────────────────────────────────────────────
# Main poll loop
# ────────────────────────────────────────────────────────────────
while true; do
  sleep "$POLL_INTERVAL"

  git -C "$REPO" fetch origin main --quiet 2>/dev/null
  current_sha=$(git -C "$REPO" rev-parse origin/main 2>/dev/null)

  if [[ "$current_sha" == "$last_sha" ]]; then
    continue
  fi

  # Record the change even if deploy fails so we don't hammer forever
  echo "[$(date)] new commit detected: $current_sha (was $last_sha)" >> "$DEPLOY_LOG"
  prev_sha=$last_sha
  last_sha=$current_sha

  if deploy "$current_sha" "$prev_sha"; then
    echo "[$(date)] deploy succeeded" >> "$DEPLOY_LOG"
  else
    echo "[$(date)] deploy failed for $current_sha; holding at previous build" >> "$DEPLOY_LOG"
  fi
done
