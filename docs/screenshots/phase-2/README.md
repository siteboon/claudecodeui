# Phase 2 visual artefacts

Screenshots captured at the standard Dispatch review viewports:
- **desktop/** — 1440×900 @ 2× DPI (iPhone 14 buddy-system desktop target)
- **mobile/** — 375×812 @ 2× DPI (iPhone 14 mobile-first target)

## What to look for

### Acceptance criteria evidence
- `desktop/02-sidebar-loaded.png` — repo grouping: the three `@cloudcli-ai/cloudcli` worktrees all collapse under the single `4GAIGE/DISPATCH (4)` group header. The `admiring-payne-e269b9`-style slugs that used to appear at the root now live under `4GAIGE/FLORITE-PLATFORM`.
- `desktop/03-project-expanded.png` — an expanded project (`wt-2`) with the "New Session" button + 2 session rows, followed by the Topic chip row (the "All" chip sits between the last session and the next project).
- `desktop/03b-topic-create.png` — topic-create input visible when the user taps the `+ Topic` button.
- `desktop/04-search-empty-disabled.png` — search scope toggle at the top is faded (opacity-40, `cursor-not-allowed`, `aria-disabled`) when the search input is empty.
- `desktop/05-search-with-text.png` — same toggle becomes active once text is entered; "No matching projects" empty state shows.
- `mobile/03-sidebar-sheet.png` — sheet opened via hamburger; sidebar fills the viewport with the same repo → project tree. Scope toggle is rendered via `.ds-segment` / `.ds-segment-item` classes.
- `mobile/04-sheet-repo-expanded.png` — `4GAIGE/DISPATCH` collapsed (chevron-right), `4GAIGE/FLO-RITE` expanded (chevron-down), `4GAIGE/FLORITE-PLATFORM` peeking at the bottom — the collapse state persists through `dispatch.sidebar.repoCollapsed.v1` in localStorage.

## Regenerating

```sh
# From the repo root:
npm install --no-save playwright
npx playwright install chromium

# Start the dev server on alternate ports so it doesn't collide with any
# production instance running on 3001/5173:
SERVER_PORT=3088 VITE_PORT=5188 HOST=127.0.0.1 npm run dev &

# Generate a JWT for the existing user (read the secret from the SQLite DB):
sqlite3 ~/.cloudcli/auth.db "select value from app_config where key='jwt_secret';" > /tmp/jwt_secret.txt
TOKEN=$(node -e 'const jwt=require("jsonwebtoken"); const s=require("fs").readFileSync("/tmp/jwt_secret.txt","utf8").trim(); const u=require("child_process").execSync("sqlite3 ~/.cloudcli/auth.db \"select id,username from users limit 1;\"").toString().trim().split("|"); console.log(jwt.sign({userId:Number(u[0]),username:u[1]},s,{expiresIn:"7d"}))')

DISPATCH_URL=http://localhost:5188 DISPATCH_TOKEN="$TOKEN" node docs/screenshots/phase-2/_capture.mjs
```

The `_capture.mjs` helper handles: auth-token seeding, onboarding-wizard skip, loading-overlay wait, and every click/type step for the captures above.
