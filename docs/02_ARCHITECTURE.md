# Architecture — claudecodeui (fork)

> Comprehensive architectural analysis of the fork at `/home/claude/projects/claudecodeui/`. This is `siteboon/claudecodeui` (npm package `@cloudcli-ai/cloudcli`) — a web UI for the Claude Code CLI plus Codex / Gemini / Cursor providers.
>
> Last analyzed: 2026-05-25 at branch `main` commit `10f721c` (v1.32.0).

---

## 1. Top-Level Layout

- **`server/`** — Express backend serving REST API + WebSocket gateway. Handles auth, database, provider CLI integration, and real-time messaging. Entry point is `server/index.js`; newer modules under `server/modules/` follow TypeScript-first patterns.

- **`src/`** — React + Vite frontend. Client-side UI for chat, file editing, git, shell, project management, and settings. Entry points: `src/main.jsx` (Vite) and `src/App.tsx` (React root).

- **`shared/`** — Isomorphic constants and utilities: `modelConstants.js` (Claude/Codex/Gemini/Cursor model lists), `networkHosts.js` (loopback normalization for dev/prod hosts).

- **`plugins/`** — `plugins/starter/` appears to be a placeholder. Plugin system exists server-side but no starter templates are populated.

- **`docker/`** — Docker Sandbox templates for Claude Code, Codex, Gemini. Subdirs per provider.

- **`public/`** — Static assets: `manifest.json` (PWA), `sw.js` (service worker), `generate-icons.js` (icon generation).

- **`scripts/`** — Build helpers: `fix-node-pty.js` (postinstall hook for node-pty compatibility).

- **`redirect-package/`** — A deprecated npm package (`@siteboon/claude-code-ui`) that re-exports `@cloudcli-ai/cloudcli` for backward compatibility. Used for package migration.

## 2. Backend (`server/`)

### Entry Point & Routing

**`server/index.js`** (1,501 lines) — Express app instantiation, middleware stack, and route wiring:
- Loads env vars via `server/load-env.js` (reads `.env` before other imports)
- Initializes database and WebSocket server
- Mounts route modules under `/api/` with auth middleware (`authenticateToken`)
- Handles file operations (project file read/write/upload/delete with path validation)
- Serves built React app from `dist/` in production; redirects to Vite dev server in dev

**Middleware stack:**
1. CORS (exposing `X-Refreshed-Token`)
2. JSON parser (50MB limit, skips multipart/form-data for file uploads)
3. URL-encoded parser
4. Optional API key validation (`X-API-Key`)
5. JWT token validation on protected routes
6. WebSocket auth on `/ws` and `/shell`

### Route Modules (`server/routes/`)

- **`auth.js`** (137 lines) — Login, logout, user creation. Issues JWT tokens (7-day expiry), auto-refresh at 50% lifetime.
- **`git.js`** (1,493 lines) — Init, status, diff, add, commit, checkout, merge, rebase. Reads `.git/config` for user.name/email; calls `git` CLI via child_process.
- **`commands.js`** (556 lines) — Scans `~/.claude/commands/` and project-level `.claude/` command definitions (TOML). Returns command list and metadata.
- **`taskmaster.js`** (1,468 lines) — Task/workflow execution. Spawns subprocesses with stdio capture. Manages task state via WebSocket.
- **`cursor.js`** (52 lines) — Cursor CLI status endpoint.
- **`gemini.js`** (25 lines) — Gemini CLI status endpoint.
- **`agent.js`** (1,240 lines) — Large endpoint suite for AI-agent-driven operations (code generation, auto-completion, testing, deployment). Calls provider SDKs (Claude SDK, OpenAI, etc.).
- **`plugins.js`** (307 lines) — Plugin discovery, enable/disable, config. Manages plugin server lifecycle via `server/utils/plugin-process-manager.js`.
- **`settings.js`** (286 lines) — User preferences, notification settings, UI theme.
- **`user.js`** (123 lines) — User profile, git config read/write.
- **`mcp-utils.js`** (31 lines) — MCP server detection and listing.

### Database Layer

**Location:** `server/modules/database/`

**Schema** (`schema.ts`, 153 lines):
- `users` — username, password_hash, git_name, git_email, is_active, onboarding flag
- `api_keys` — user-bound API keys with creation/last-used timestamps
- `user_credentials` — GitHub/GitLab/Bitbucket tokens (credential_type enum)
- `projects` — project_id (PK), project_path (UNIQUE), custom name, starred/archived flags
- `sessions` — session_id (PK), provider, custom_name, project_path (FK), jsonl_path, archived flag
- `push_subscriptions` — for Web Push notifications (VAPID)
- `app_config` — key-value store for JWT secret, VAPID keys
- Additional tables: `user_notification_preferences`, `vapid_keys`, `scan_state`

**Migrations** (`migrations.ts`, 455 lines) — Applied at startup; repair/upgrade legacy schema (e.g., adding project_path to sessions, normalizing project table columns).

**Repositories** (in `server/modules/database/repositories/`) — One const-exported object per table: `userDb`, `projectsDb`, `sessionsDb`, `apiKeysDb`, `credentialsDb`, `vapidKeysDb`, `appConfigDb`, `scanStateDb`, etc. Methods: `getById`, `create`, `update`, `delete`, `list`. Underlying store: `better-sqlite3` (sync DB, suitable for embedded use).

**Gotcha:** Migrations are applied at every server startup in `initializeDatabase()`. Schema changes don't require manual migration files; code applies missing columns/tables on the fly. Efficient for OSS but can hide schema issues.

### Modules (TypeScript-first patterns)

**`server/modules/providers/`** — Provider abstraction. Each provider implements `IProvider` interface (auth, sessions, MCP, skills, session sync).
- `provider.registry.ts` — Registry of all provider implementations.
- `services/session-synchronizer.service.ts` — Watches provider CLI directories (e.g., `~/.claude/projects`) and syncs sessions into DB.
- `services/mcp.service.ts` — Lists MCP servers per provider/scope.
- `services/skills.service.ts` — Lists provider-specific "skills" (built-in commands).
- Per-provider subdirs (`list/claude/`, `list/codex/`, etc.) implement auth, sessions, MCP, and sync logic.

**`server/modules/websocket/`** — WebSocket gateway.
- `services/websocket-server.service.ts` (58 lines) — Creates ws.WebSocketServer, routes `/ws` (chat), `/shell` (terminal), `/plugin-ws/...` (plugin proxy).
- `services/chat-websocket.service.ts` (271 lines) — Chat message flow; calls provider query methods; normalizes responses.
- `services/shell-websocket.service.ts` (453 lines) — Terminal emulator; manages `node-pty` process; streams xterm ANSI.
- `services/plugin-websocket-proxy.service.ts` (65 lines) — Proxies WS traffic to plugin server processes.
- `services/websocket-auth.service.ts` (54 lines) — JWT verification for WS upgrade.

**`server/modules/projects/`** — Project lifecycle.
- `services/project-management.service.ts` — Create, list, archive, delete projects.
- `services/project-clone.service.ts` — Clone from GitHub URL.
- `services/projects-with-sessions-fetch.service.ts` — Join projects with sessions for frontend.

### Provider CLI Adapters (Legacy, Alongside Modules)

Old pattern kept for backward compatibility:
- **`claude-sdk.js`** (837 lines) — Wraps `@anthropic-ai/claude-agent-sdk`. Spawns Claude Code CLI, captures stdout/stderr, normalizes JSON messages. Handles tool approvals.
- **`cursor-cli.js`** (334 lines) — Cursor CLI adapter.
- **`openai-codex.js`** (458 lines) — OpenAI Codex (HTTP API).
- **`gemini-cli.js`** (617 lines) — Gemini CLI adapter.

These are called directly by the WebSocket chat handler and `agent.js` route. New code in `server/modules/providers/` is gradually replacing them.

### Middleware

**`server/middleware/auth.js`** (133 lines):
- `validateApiKey()` — Optional (skipped if `API_KEY` env not set). Checks `X-API-Key` header.
- `authenticateToken()` — JWT validation (Bearer token or query param). Auto-refreshes token if >50% expired; returns new token in `X-Refreshed-Token` header. In "platform mode" (`IS_PLATFORM`), returns first user from DB (no JWT check).
- `generateToken()` — Issues 7-day JWT.
- `authenticateWebSocket()` — Extracts token from WS query params; validates JWT.

### Utilities

- **`server/utils/runtime-paths.js`** — Resolves app root and module dirs (works from both source `/server` and compiled `/dist-server/server`).
- **`server/utils/plugin-process-manager.js`** — Spawns and manages plugin server subprocesses.
- **`server/utils/url-detection.js`** — ANSI stripping, URL extraction from CLI output.
- **`server/utils/gitConfig.js`** — Reads/writes `.git/config` and `~/.gitconfig`.
- **`server/utils/commandParser.js`** — Parses TOML command definitions.
- **`server/utils/mcp-detector.js`** — Detects MCP server configs in `~/.claude.json` and provider-specific config dirs.

## 3. Frontend (`src/`)

### Entry Points

- **`src/main.jsx`** (536 bytes) — Vite entry; mounts React app.
- **`src/App.tsx`** (38 lines) — Provider stack (Auth, WebSocket, Plugins, TaskMaster, Themes) + Router setup. Routes: `/` (main) and `/session/:sessionId` (session detail).

### Routing & Layout

**`src/components/app/AppContent.tsx`** — Orchestrates main layout: sidebar, chat panel, editor, file tree, git panel, shell, depending on active tab.

### State Management

- **`src/stores/useSessionStore.ts`** — Zustand store for session messages. Per-session Map keyed by sessionId. No localStorage; backend JSONL is source of truth.
- **`src/contexts/WebSocketContext.tsx`** — Manages WS connection; dispatches real-time messages to store.
- **`src/contexts/TaskMasterContext.ts`** — TaskMaster context (task runner workflow state).
- **`src/contexts/PluginsContext.tsx`** — Loaded plugins metadata.
- **`src/contexts/ThemeContext.jsx`** — Light/dark mode.

### Component Tree (~292 files)

Major feature folders:

- **`components/chat/`** — Chat UI (composer, message display, token usage indicator, code block rendering).
- **`components/code-editor/`** — CodeMirror-based editor with syntax highlighting, merge view.
- **`components/file-tree/`** — Project file explorer; right-click context menu for create/rename/delete.
- **`components/git-panel/`** — Git status, diff viewer, commit UI.
- **`components/shell/`** — xterm.js terminal emulator.
- **`components/sidebar/`** — Project switcher, session list, settings toggle.
- **`components/project-creation-wizard/`** — Onboarding: select existing folder or clone from GitHub.
- **`components/task-master/`** — Task runner UI (DAG execution, step logs).
- **`components/settings/`** — Model selection, provider auth, MCP config, notifications.
- **`components/mcp/`** — MCP server discovery and enable/disable UI.
- **`components/auth/`** — Login, signup, protected routes.
- **`components/command-palette/`** — Cmd/Ctrl+K quick command search.
- **`components/prd-editor/`** — PRD (Product Requirement Document) editor with frontmatter.
- **`components/plugins/`** — Plugin marketplace UI.
- **`components/provider-auth/`** — Provider-specific auth flows (Claude, Codex, Gemini, Cursor).

### Hooks

- `useSessionProtection()` — Locks session on blur, asks confirmation on unload.
- `useVersionCheck()` — Detects new versions.
- `useWebPush()` — Registers service worker and push subscriptions.
- `useUiPreferences()` — Persists UI state (theme, panel sizes, etc.) to localStorage.
- `useGitHubStars()` — Fetches repo stars for "give us a star" prompt.

### Utils

- **`src/utils/api.js`** — HTTP client (`authenticatedFetch`); auto-handles JWT refresh from `X-Refreshed-Token`.
- **`src/utils/clipboard.ts`** — Copy-to-clipboard helper.
- **`src/constants/config.ts`** — Reads `import.meta.env.VITE_IS_PLATFORM` (boolean mode flag).

## 4. Provider Integrations

All four providers (Claude, Codex/OpenAI, Gemini, Cursor) are abstracted behind a common interface.

### Architecture

**Common Interface** (`server/shared/interfaces.ts`):

```typescript
interface IProvider {
  readonly id: LLMProvider;
  readonly mcp: IProviderMcp;
  readonly auth: IProviderAuth;
  readonly skills: IProviderSkills;
  readonly sessions: IProviderSessions;
  readonly sessionSynchronizer: IProviderSessionSynchronizer;
}
```

**Per-provider implementations** (under `server/modules/providers/list/`):
- Each provider implements `IProvider`, exposing auth (login, token refresh), session history, MCP discovery, and skills (built-in commands).
- **Auth:** Reads from user home dir (`~/.claude.json`, `~/.config/cursor/`, etc.). Credentials stored in DB (`user_credentials` table) keyed by provider.
- **Sessions:** Scans CLI-generated session files (JSONL for Claude, SQLite for Cursor, raw logs for Gemini). Syncs into DB via `session-synchronizer` service.
- **MCP:** Reads provider-specific MCP config (Claude reads `~/.claude.json`'s MCP section; Gemini reads `~/.config/gemini/`).

### Session Sync

**`server/modules/providers/services/sessions-watcher.service.ts`** — File watcher that monitors `~/.claude/projects`, `~/.cursor/`, etc. Detects new/updated sessions and upserts into `sessions` table. Runs on startup and continuously.

**Pattern:** `sessionSynchronizer.sync()` is called per provider to discover sessions, then DB is queried to hydrate frontend. No polling; uses chokidar for file watch events.

### Model Constants

Shared model definitions in `shared/modelConstants.js`. Each provider has a list of available models. Frontend uses this to populate model selector; backend CLI calls use the same list.

## 5. Real-Time Layer

### WebSocket Endpoints

- **`/ws`** — Chat. Incoming messages have `{ sessionId, provider, message, model, ... }`. Server calls provider query methods, streams responses back as `{ type, payload, ... }`.
- **`/shell`** — Terminal. Incoming: `{ command, ... }`. Spawns process via `node-pty`, streams xterm output.
- **`/plugin-ws/:pluginName`** — Proxy to plugin server listening on dynamic port.

### Message Flow (Chat)

1. Frontend WebSocket sends user message with sessionId + provider.
2. `handleChatConnection()` dispatches to provider's message handler (e.g., `queryClaudeSDK()`).
3. Provider spawns/calls CLI and streams back normalized messages.
4. Server writes to backend JSONL file (e.g., `~/.claude/projects/[project]/[sessionId].jsonl`).
5. Server broadcasts message to all connected clients for that session.
6. Frontend appends to `useSessionStore()` and re-renders.

### WebSocket State

**`websocket-state.service.ts`** — Global `connectedClients` Map for tracking active WS connections per user. Used for broadcast logic.

## 6. Auth Model

### Login Flow

1. User visits `/` → frontend checks for JWT in localStorage.
2. If no token, redirects to `/login` → login form posts `{ username, password }` to `/api/auth/login`.
3. Backend verifies password hash (bcrypt, `better-sqlite3`), returns JWT (7-day expiry).
4. Frontend stores JWT in localStorage; sets `Authorization: Bearer <token>` on subsequent API calls.

### Token Management

- JWT secret auto-generated on first startup: `appConfigDb.getOrCreateJwtSecret()` → stored in `app_config` table.
- Token is auto-refreshed: if >50% expired, server issues new token in `X-Refreshed-Token` response header.
- Frontend (`api.js`) detects header and updates localStorage automatically.

### Platform Mode

If `IS_PLATFORM=true` (Docker/managed deployment), auth is bypassed:
- `authenticateToken()` returns first user from DB (no JWT check).
- `authenticateWebSocket()` returns first user (no token needed).
- Useful for single-user deployments (Docker sandboxes, personal machines).

### Session Storage

JWT stored in browser localStorage (`token` key). No HttpOnly flag; frontend can access it (needed for dynamic WS auth).

**Gotcha:** Tokens are not invalidated on logout; they expire naturally or can be cleared from localStorage. Logout simply removes local token; backend has no revocation list.

## 7. Config and Environment

### Backend (`process.env`)

- `SERVER_PORT` — Express server port (default: 3001).
- `HOST` — Bind address (default: 0.0.0.0).
- `VITE_PORT` — Dev server port (default: 5173, only in dev mode).
- `DATABASE_PATH` — SQLite auth.db location (default: `~/.cloudcli/auth.db`).
- `CONTEXT_WINDOW` — Token context window size (default: 160000). Used to display token usage.
- `CLAUDE_CLI_PATH` — Path to claude CLI (default: `claude`).
- `CLAUDE_TOOL_APPROVAL_TIMEOUT_MS` — Tool approval wait (default: 55000ms).
- `CLAUDE_CODE_STREAM_CLOSE_TIMEOUT` — Stream timeout (default: 300000ms when approving tools).
- `GEMINI_CLI_HOME` — Gemini home dir (default: `os.homedir()`).
- `GEMINI_PATH` — Path to gemini CLI (default: `gemini`).
- `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `GOOGLE_CLOUD_PROJECT*`, `GOOGLE_APPLICATION_CREDENTIALS` — Gemini auth env vars.
- `API_KEY` — Optional static API key for `/api` routes (if set, validates `X-API-Key` header).
- `JWT_SECRET` — Auth secret (auto-generated if not set).
- `WORKSPACES_ROOT` — Workspace root path (default: home dir).
- `IS_PLATFORM` — Platform mode flag (default: false). Bypasses JWT.

Loaded from `.env` file (if present) in `server/load-env.js`, applied before other imports.

### Frontend (`import.meta.env`)

- `VITE_CONTEXT_WINDOW` — Mirrors backend context window (default: 160000).
- `VITE_IS_PLATFORM` — Boolean flag to disable certain UI features in platform mode.

Built by Vite at compile time; values are static in the bundle.

### `.env.example`

Documents: `SERVER_PORT`, `VITE_PORT`, `HOST`, `CLAUDE_CLI_PATH`, `DATABASE_PATH`, `CONTEXT_WINDOW`, `VITE_CONTEXT_WINDOW`.

## 8. Build, Dev, and Packaging

### npm Scripts

- `npm run dev` — Concurrently start backend (tsx watch) + Vite dev server. Hot reload on both.
- `npm run build` — Compile client (`vite build` → `dist/`) then server (`tsc -p server/tsconfig.json` + `tsc-alias` → `dist-server/`).
- `npm run build:client` — Vite build only.
- `npm run build:server` — TypeScript compile server to `dist-server/` with path alias resolution.
- `npm start` — `npm run build` + `node dist-server/server/index.js`.
- `npm run server:dev` — Run server via tsx (fast, watches for changes).
- `npm run preview` — Vite preview (production build locally).

### Vite Config (`vite.config.js`)

- Alias: `@/ → src/`
- Dev proxy: `/api`, `/ws`, `/shell` → backend server (configurable host/port).
- Build: Manual chunk split for vendor libraries (React, CodeMirror, xterm) to reduce bundle size.
- Output dir: `dist/`

### TypeScript Config

**`tsconfig.json`** (frontend) — Strict mode, React JSX, path alias `@/`.

**`server/tsconfig.json`** — Strict mode, ES2022 target, baseUrl set to project root so `@/server/*` resolves correctly post-compile. Includes server and shared folders. Emits to `dist-server/`. `tsc-alias` rewrites import paths post-compile.

### Published NPM Package

**Name:** `@cloudcli-ai/cloudcli`

**Files included:** `server/` (source), `shared/` (source), `dist/` (built frontend), `dist-server/` (built backend), `scripts/`, `README.md`.

**Bin entry:** `cloudcli` → `dist-server/server/cli.js` (CLI entry point).

**Main:** `dist-server/server/index.js` (programmatic entry).

### Redirect Package

**`redirect-package/`** — Published as deprecated package `@siteboon/claude-code-ui` and re-exports `@cloudcli-ai/cloudcli`. Allows old installs to upgrade gracefully.

## 9. Plugins

**`plugins/starter/`** — Empty folder (no plugin starter template included).

**Plugin system exists server-side:**
- `server/utils/plugin-process-manager.js` — Spawns plugin server subprocesses on startup (listens on dynamic ports).
- `server/modules/websocket/services/plugin-websocket-proxy.service.ts` — Proxies `/plugin-ws/...` to plugin processes.
- `server/routes/plugins.js` — Endpoint to list, enable, disable plugins.

No plugin loading mechanism exposed to end users in this scan. Plugins are developer-only or require direct file system setup.

## 10. Docker

**`docker/` subdirs:**
- `claude-code/`, `codex/`, `gemini/` — Dockerfile + scripts per provider.
- `shared/` — Shared Docker setup (base image, common layers).

These are Docker Sandbox templates (not traditional Docker Compose).

## 11. Tests

**Minimal test coverage:**
- `server/shared/claude-cli-path.test.ts` — Tests Claude CLI path resolution.
- `server/modules/database/repositories/sessions.db.integration.test.ts` — Sessions DB integration test.
- `server/modules/database/repositories/projects.db.integration.test.ts` — Projects DB integration test.
- `server/modules/providers/tests/mcp.test.ts` — MCP service tests.
- `server/modules/providers/tests/skills.test.ts` — Skills service tests.
- `server/modules/projects/tests/project-*.service.test.ts` — Project management tests (create, clone, star, delete, TaskMaster detection).

**No frontend test suite.** No test runner configured (`jest`, `vitest`) in package.json scripts.

## 12. Hot Spots to Know Before Editing

**Large/Central Files:**

- **`server/index.js`** (1,501 lines) — All top-level Express setup; hard to split without significant refactor.
- **`server/routes/agent.js`** (1,240 lines) — Monolithic agent endpoint suite; mixes multiple AI-agent workflows.
- **`server/routes/taskmaster.js`** (1,468 lines) — Task runner logic; complex state machine.
- **`server/routes/git.js`** (1,493 lines) — Git integration; every git command is a route handler.
- **`server/modules/websocket/services/chat-websocket.service.ts`** (271 lines) — Chat message dispatch; calls all provider query methods.
- **`server/modules/websocket/services/shell-websocket.service.ts`** (453 lines) — Terminal emulation; handles xterm protocol.
- **`server/claude-sdk.js`** (837 lines) — Claude SDK wrapper; complex message normalization.
- **`src/stores/useSessionStore.ts`** — Session message store; heavily imported by chat, history, editor components.

**High Fan-In Files (imported by many others):**

- `server/modules/database/index.ts` — All DB repositories; used everywhere backend needs data.
- `server/modules/providers/provider.registry.ts` — Provider registry; used by chat, settings, auth routes.
- `src/utils/api.js` — HTTP client; used by every component that calls backend.
- `src/stores/useSessionStore.ts` — Session store; used by chat, editor, shell, file-tree components.
- `src/contexts/WebSocketContext.tsx` — WS connection; used by chat, shell, task-master.
- `shared/modelConstants.js` — Model definitions; used by UI (model selector) and backend (provider config).

## 13. Risks & Gotchas

1. **Schema applied at startup** — `initializeDatabase()` runs migrations on every server boot. Missing columns are added dynamically; schema bugs can lurk until first upgrade. Test migrations on staged data.

2. **Shared state via `~/.claude/`, `~/.gemini/`, etc.** — Backend reads/writes session files and config directly from home dirs. If multiple CloudCLI instances run on the same machine as the same user (this is exactly our fork-alongside-original setup), they will race on file locks. No distributed lock mechanism.

3. **Legacy adapter pattern coexists with new modules** — Old code (`claude-sdk.js`, `cursor-cli.js`, etc.) coexists with new `server/modules/providers/` architecture. Provider calls may go through either path; inconsistent error handling.

4. **WebSocket auth via query params** — WS can't send custom headers; token is passed in URL (`?token=...`). Exposes token in browser history / server logs. Acceptable for same-machine use; risky for remote deployments.

5. **No revocation list for JWTs** — Tokens valid until expiry; no way to force logout globally. Logout only clears localStorage.

6. **Platform mode disables all auth** — If `IS_PLATFORM=true`, no JWT needed; assumes single user in managed environment. Not suitable for multi-user OSS deployments without changes.

7. **File path validation** — All project file operations validate paths stay within project root (e.g., `validatePathInProject`). Validation logic is repeated across multiple endpoints; inconsistent application could lead to directory traversal if logic bugs exist.

8. **Uncontrolled subprocess spawning** — Tasks, git operations, and plugin servers spawn subprocesses with `child_process.spawn`. No resource limits (CPU, memory, file handles).

9. **Session sync via file watch** — `chokidar` watches provider CLI directories for new sessions. If directories are on slow network mounts, sync can lag or fail silently.

10. **Component tree complexity** — ~292 component files with heavy nesting (e.g., chat has 10+ subfolders). Refactoring UI is tedious; circular dependency risk when extracting shared logic.

---

**Summary:** This is a mature, multi-provider web IDE with solid abstractions for provider plugins, database-backed persistence, and real-time messaging. The transition from legacy adapters to new TypeScript modules is in progress. Key strengths are the unified provider interface and comprehensive git/task support. Key weaknesses are monolithic route files and tight coupling to local file system paths.
