#!/usr/bin/env bash
# Auto-generate docs/_sidebar.md (and keep the docsify homepage valid) from the
# Markdown files in this folder.
#
#   - Sidebar order follows filename sort, so numeric prefixes (00_, 01_, ...)
#     control ordering.
#   - Each entry's label is the file's first "# H1" heading (falls back to the
#     filename if there is no H1).
#   - The docsify homepage is pointed at the README-ish file (or the first file)
#     so the site root keeps working even after files are renamed.
#
# Usage:
#   ./gen-sidebar.sh            generate once and exit
#   ./gen-sidebar.sh --watch    stay running; regenerate whenever a .md changes
set -euo pipefail

DOCS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SIDEBAR="$DOCS_DIR/_sidebar.md"
INDEX="$DOCS_DIR/index.html"

is_special() {  # docsify control / generated files that must not appear in nav
  case "$1" in _sidebar.md|_navbar.md|_coverpage.md) return 0 ;; *) return 1 ;; esac
}

generate() {
  local tmp homepage="" b label
  tmp="$(mktemp)"
  while IFS= read -r f; do
    b="$(basename "$f")"
    is_special "$b" && continue
    label="$(grep -m1 '^# ' "$f" | sed -e 's/^# *//' -e 's/[`*]//g' || true)"
    [ -z "$label" ] && label="$b"
    printf -- '- [%s](%s)\n' "$label" "$b" >> "$tmp"
    if [ -z "$homepage" ] && printf '%s' "$b" | grep -qi 'readme'; then homepage="$b"; fi
  done < <(find "$DOCS_DIR" -maxdepth 1 -name '*.md' | sort)

  # first file becomes homepage if there is no README-ish file
  if [ -z "$homepage" ]; then
    homepage="$(find "$DOCS_DIR" -maxdepth 1 -name '*.md' \
      ! -name '_*' -printf '%f\n' | sort | head -1 || true)"
  fi

  mv "$tmp" "$SIDEBAR"

  # keep the docsify root page valid (default README.md may have been renamed)
  if [ -n "$homepage" ] && [ -f "$INDEX" ]; then
    if grep -q "homepage:" "$INDEX"; then
      sed -i "s|homepage: *'[^']*'|homepage: '$homepage'|" "$INDEX"
    else
      sed -i "s|loadSidebar: true,|loadSidebar: true,\n      homepage: '$homepage',|" "$INDEX"
    fi
  fi

  echo "[gen-sidebar] $(date '+%H:%M:%S') wrote $(grep -c '^- ' "$SIDEBAR") entries (homepage=${homepage:-default})"
}

content_sig() {  # signature of content files only -> avoids reacting to our own writes
  find "$DOCS_DIR" -maxdepth 1 -name '*.md' \
    ! -name '_sidebar.md' ! -name '_navbar.md' ! -name '_coverpage.md' \
    -printf '%f %T@\n' 2>/dev/null | sort | md5sum
}

generate

if [ "${1:-}" = "--watch" ]; then
  echo "[gen-sidebar] watching $DOCS_DIR for .md changes (poll 1s) ..."
  # Poll a signature of the content files (names + mtimes). This catches adds,
  # deletes, renames and edits, and never drops events. The signature excludes
  # our own generated output, so regenerating does not retrigger.
  prev="$(content_sig)"
  while :; do
    cur="$(content_sig)"
    [ "$cur" != "$prev" ] && { generate; prev="$cur"; }
    sleep 1
  done
fi
