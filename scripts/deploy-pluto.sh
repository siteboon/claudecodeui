#!/usr/bin/env bash
# Deploy the shared CloudCLI UI checkout on Pluto.

set -euo pipefail

usage() {
    cat <<'EOF'
Usage: scripts/deploy-pluto.sh [--dry-run] [--allow-dirty]

Builds the shared UI checkout through the host setup script, then restarts
claudecodeui@config, claudecodeui@jorge, and claudecodeui@jonas.

Environment overrides:
  APP_DIR=/srv/claudecodeui
  SETUP_SCRIPT=/home/config/servers/hosts/pluto/claudecodeui/setup.sh
  SERVICES="claudecodeui@config claudecodeui@jorge claudecodeui@jonas"
EOF
}

DRY_RUN=0
ALLOW_DIRTY="${ALLOW_DIRTY:-0}"

while [ "$#" -gt 0 ]; do
    case "$1" in
        --dry-run)
            DRY_RUN=1
            ;;
        --allow-dirty)
            ALLOW_DIRTY=1
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "[deploy] Unknown argument: $1" >&2
            usage >&2
            exit 2
            ;;
    esac
    shift
done

run() {
    printf '[deploy] +'
    printf ' %q' "$@"
    printf '\n'
    if [ "$DRY_RUN" -eq 0 ]; then
        "$@"
    fi
}

APP_DIR="${APP_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
APP_DIR="$(cd "$APP_DIR" && pwd)"
SERVICES="${SERVICES:-claudecodeui@config claudecodeui@jorge claudecodeui@jonas}"

find_setup_script() {
    if [ -n "${SETUP_SCRIPT:-}" ]; then
        printf '%s\n' "$SETUP_SCRIPT"
        return
    fi

    for candidate in \
        "/home/config/servers/hosts/pluto/claudecodeui/setup.sh" \
        "${HOME}/servers/hosts/pluto/claudecodeui/setup.sh"; do
        if [ -f "$candidate" ]; then
            printf '%s\n' "$candidate"
            return
        fi
    done

    echo "[deploy] Could not find the Pluto claudecodeui setup script." >&2
    echo "[deploy] Set SETUP_SCRIPT=/path/to/setup.sh and retry." >&2
    exit 1
}

SETUP_SCRIPT="$(find_setup_script)"

if [ ! -f "$APP_DIR/package.json" ] || [ ! -d "$APP_DIR/.git" ]; then
    echo "[deploy] APP_DIR is not the claudecodeui checkout: $APP_DIR" >&2
    exit 1
fi

if [ ! -f "$SETUP_SCRIPT" ]; then
    echo "[deploy] Setup script does not exist: $SETUP_SCRIPT" >&2
    exit 1
fi

cd "$APP_DIR"

if [ "$ALLOW_DIRTY" != "1" ]; then
    dirty="$(
        git status --porcelain --untracked-files=all -- \
            . \
            ':(exclude)dist-config/**' \
            ':(exclude)dist-jorge/**' \
            ':(exclude)dist-jonas/**'
    )"
    if [ -n "$dirty" ]; then
        echo "[deploy] Refusing to deploy with uncommitted UI changes." >&2
        echo "$dirty" >&2
        echo "[deploy] Commit and push first, or rerun with --allow-dirty." >&2
        exit 1
    fi
fi

upstream="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)"
if [ -n "$upstream" ]; then
    run git fetch --quiet
    read -r ahead _behind < <(git rev-list --left-right --count "HEAD...$upstream")
    if [ "$ahead" != "0" ] && [ "${ALLOW_UNPUSHED:-0}" != "1" ]; then
        echo "[deploy] Refusing to deploy commits that are not pushed to $upstream." >&2
        echo "[deploy] Push first, or set ALLOW_UNPUSHED=1." >&2
        exit 1
    fi
fi

echo "[deploy] App checkout: $APP_DIR"
echo "[deploy] Setup script: $SETUP_SCRIPT"

if [ "$(id -un)" = "config" ]; then
    run bash "$SETUP_SCRIPT"
else
    run sudo -n -u config env HOME=/home/config USER=config bash "$SETUP_SCRIPT"
fi

# shellcheck disable=SC2206
service_list=( $SERVICES )
run sudo systemctl restart "${service_list[@]}"
run sudo systemctl is-active "${service_list[@]}"

echo "[deploy] Done."
