# Phase 2 sub-plan — worktree sessions

Design: a Workbench session = git worktree (`ws/<slug>` branch) registered as a project (existing `server/modules/worktrees`) + a row in a new `workbench_sessions` table + a PTY in the Shell tab started with `cwd = worktree`, env `WORKBENCH_SESSION_ID`, `WORKBENCH_PORT`, `WORKBENCH_HOOK_TOKEN`. New server module `server/modules/workbench-sessions/`, new frontend module `src/modules/workbench-sessions/`. Everything shells out to `git` with argv (`spawn(args[])`), never shell strings.

## Slices (each ends with typecheck + tests + commit)
1. **Server core** — store (table created lazily in the existing SQLite), slug/branch/worktree path rules, `.env*` copy, create/list/get, git ops (diff, commit, rebase, squash-merge with confirm + clean-main check, push, unpushed count, discard with confirm), tests against a real temp git repo.
2. **Launch + status** — Shell `init` accepts `workbenchSessionId`; server builds the CLI command (profile flags, first prompt via temp file, never string-interpolated), sets env; PTY output/exit drive `lastActivityAt` and idle-based status fallback; token-protected `POST /api/workbench/hooks`.
3. **Hooks + consent** — hook scripts (`.cmd`/PowerShell on Windows, POSIX sh elsewhere) that exit silently when `WORKBENCH_SESSION_ID` is unset; install/uninstall endpoints that back up `~/.claude/settings.json` and merge (never overwrite) only after an explicit UI confirmation. Codex `notify` is NOT implemented until the format can be verified (codex is not installed on this PC); idle detection covers Codex.
4. **Frontend** — New Session dialog, sidebar section grouped by project (title, agent, branch, status badge, last activity, unpushed badge), session view (terminal + diff panel with per-file collapse + action bar), confirmation dialogs, Windows/OS notifications on `waiting`/`done`.
5. **Resume + run script** — store `cliSessionId` (read from the CLI's session log, read-only), `claude --resume` on restart; per-project run script in a second terminal with `PORT` offset per session.

## Explicit non-goals for now
Codex `notify` hook, "let the agent write the commit message", profiles (Phase 4; `profileId` stored as `none`).
