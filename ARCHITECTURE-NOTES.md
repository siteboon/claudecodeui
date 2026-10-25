# Workbench — Architecture Notes (Phase 0)

Base: CloudCLI `@cloudcli-ai/cloudcli` v1.37.5 (AGPL-3.0). Express 4 + `ws` + better-sqlite3 + node-pty, ESM, TypeScript server. Findings come from a read-only code survey; items marked **UNVERIFIED** were not checked by running the app.

## Server
- Entry: `server/index.ts` (dev: `npm run server:dev` via tsx; prod: `dist-server/server/index.js`). `server/load-env.ts` loads `.env` first and defaults `DATABASE_PATH` to `~/.cloudcli/auth.db`.
- Binding: `SERVER_PORT` (default 3001), `HOST` (**default `0.0.0.0`**, see Deviations). `/health` endpoint exists.
- Routes under `/api`: auth, file-tree, projects, git, worktrees, settings, providers, scheduled-messages, agent, voice, plugins, etc. Most use JWT (`authenticateToken`); `/api/agent` and `/api/browser-use-mcp` are mounted without it.
- Env: `API_KEY`, `JWT_SECRET`, `DATABASE_PATH`, `CLAUDE_CLI_PATH`, `CLAUDE_CONFIG_DIR`.

## Sessions: how they are spawned
- **Claude chat: headless via `@anthropic-ai/claude-agent-sdk`** (`server/modules/providers/list/claude/claude-runtime.provider.js`). Uses `pathToClaudeCodeExecutable` (resolved via `server/shared/claude-cli-path.ts`, falls back to SDK-bundled binary). Passes full `process.env`; `settingSources = project,user,local`. No API-key/OAuth handling in server code; auth is whatever the spawned CLI finds.
- **Codex chat: headless via `@openai/codex-sdk`** (`providers/list/codex/codex-runtime.provider.ts`, `new Codex()` without apiKey). `codex-app-server.client.ts` spawns `codex app-server` (JSON-RPC).
- **PTY (node-pty) only for the Shell tab**: `server/modules/websocket/services/shell-websocket.service.ts`; runs `claude`/`codex`/plain shell with `...process.env`.
- Cursor and OpenCode providers also exist (cross-spawn).

## Projects
- Project = row in SQLite `projects` (`project_path` UNIQUE). Sessions are indexed from `~/.claude/projects/**.jsonl` (+ `history.jsonl`), `~/.codex/sessions/**` (+ `session_index.jsonl`), `~/.cursor/*` by `providers/services/session-synchronizer.service.ts`; chokidar watcher `sessions-watcher.service.ts` broadcasts `session_upserted`.

## WebSocket protocol
- `/ws` chat (JWT in `?token=`): client `chat.send|edit-send|abort|stop-task|subscribe|permission-response`; server envelope keyed by `kind` with per-event `seq` and replay buffer (`chat-run-registry.service.ts`). One `complete` per run.
- `/shell` PTY: `init`, `input`, `resize` → `output`, `auth_url`, `claude_theme`.
- `/desktop-notifications`, `/plugin-ws/:name` (proxy to plugin). Docs: `server/modules/websocket/README.md`.

## Frontend
Vite 7, React 18, TS, Tailwind 3, react-router 6, i18next, CodeMirror, xterm.js (webgl/fit/clipboard). State = React Context + hooks only. Feature modules in `src/modules/*`. Guidance in `AGENTS.md`.

## Codex integration
`server/modules/providers/list/codex/` (runtime, app-server client, auth, models (reads `config.toml`), mcp (writes `config.toml`), skills, sessions, synchronizer).

## Storage
SQLite `~/.cloudcli/auth.db` (users, api_keys, **user_credentials incl. plaintext GitHub tokens**, projects, sessions, scheduled_messages, session_drafts, …). Other: `~/.cloudcli/*`, plugins in `~/.claude-code-ui/`. Electron: `userData/{cloud-account,desktop-settings,desktop-notifications-settings}.json`.

## Existing `electron/` folder (overlaps Phase 1)
`main.js` (944 lines), `localServer.js`, `serverInstaller.js`, `desktopWindow.js`, `viewHost.js`, `tabs.js`, `cloud.js` (CloudCLI Cloud account + `cloudcli://` deep link, control plane `https://cloudcli.ai`), `desktopNotifications.js`, launcher UI. **Server runs as a child process** (`ELECTRON_RUN_AS_NODE=1`, port 3001 or free, reuses an already-running CloudCLI via `/health` unless `ELECTRON_FORCE_OWN_SERVER=1`). Scripts: `desktop:dev`, `desktop:pack`, `desktop:dist:win|mac`. Phase 1 should adapt this rather than start from scratch, and strip the cloud-account feature.

## Existing worktree code
`server/modules/worktrees/` (create/list/open/remove/merge via `git worktree`; registers worktrees as projects). Routes `/api/worktrees`. No dedicated frontend module found (UNVERIFIED). Phase 2 should build on this.

## `~/.claude` / `~/.codex` access (Hard rule 1 audit)
**Credential/token READS (flag):**
- `claude-auth.provider.ts`: reads `~/.claude/settings.json` `env` block (may hold API keys/tokens), checks env tokens (presence only), and **parses `~/.claude/.credentials.json`** (`claudeAiOauth.accessToken/refreshToken/expiresAt`) to decide logged-in/expired. Returns only email+method; no refresh, no write.
- `codex-auth.provider.ts`: **reads `~/.codex/auth.json`**, decodes `id_token` for email. Read-only.
- opencode auth reads `~/.local/share/opencode/auth.json`.

**Writes / deletes in tool dirs (flag):**
- `claude-mcp.provider.ts` rewrites `~/.claude.json` (MCP servers); `codex-mcp.provider.ts` rewrites `~/.codex/config.toml` (TOML round-trip may drop comments).
- `sessions.service.ts`, `project-delete.service.ts` delete transcript JSONL under `~/.claude/projects` and `~/.codex/sessions`.
- `agent/agent.routes.ts` clones into `~/.claude/external-projects/` and `fs.rm`s it and `~/.claude/sessions/<sessionId>` (check `sessionId` traversal).

**Read-only metadata:** session JSONL, `history.jsonl`, skills/commands dirs, `settings*.json` permissions and theme, `~/.claude/sessions/<pid>.json` liveness, `~/.codex/config.toml` models.

## Deviations from WORKBENCH-PLAN.md (need Kevin's decision)
1. **Agent SDK in use.** Hard rule 1 says don't use the Agent SDK with subscription auth. CloudCLI's Claude chat does exactly that. Workbench sessions must instead be PTY-launched `claude` / `codex` (or `claude -p` / `codex exec`). Decide: disable/remove the SDK chat path or keep it unused.
2. **Credential files are parsed** (`.credentials.json`, `auth.json`). Plan says never read credentials. Proposal: replace with `claude auth status`-style CLI checks or drop the check; remove token parsing.
3. **App writes `~/.claude.json` and `~/.codex/config.toml`** (MCP management). Disable or require consent+backup.
4. **Default `HOST=0.0.0.0`**; Hard rule 3 requires `127.0.0.1`. Force it in Workbench.
5. **Unauthenticated `/api/agent`** route and plaintext GitHub tokens in SQLite. Disable the route; avoid the token store.
6. **Electron cloud-account/deep-link features** call `cloudcli.ai`; remove for Workbench.
7. `codex` is not on PATH on this PC; Codex sessions untested.
