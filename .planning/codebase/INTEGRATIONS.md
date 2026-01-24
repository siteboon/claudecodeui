# External Integrations

**Analysis Date:** 2026-01-24

## APIs & External Services

**AI Code Assistants:**
- Claude (via Claude SDK) - Primary code generation and task execution
  - SDK: @anthropic-ai/claude-agent-sdk 0.1.29
  - Integration: `server/claude-sdk.js`
  - Features: Session management, tool approval flow, WebSocket streaming
  - Auth: Via Claude CLI authentication (~/.claude/)

- OpenAI Codex - Secondary code generation option
  - SDK: @openai/codex-sdk 0.75.0
  - Integration: `server/openai-codex.js`
  - Auth: Env var `OPENAI_API_KEY`

- Cursor (via CLI) - Alternative AI assistant
  - Integration: `server/cursor-cli.js`
  - Spawns as child process
  - Configuration: Reads from ~/.cursor/ config

**Version Control:**
- GitHub - Repository operations and API access
  - SDK: @octokit/rest 22.0.0
  - Integration: `server/routes/agent.js`, `server/routes/projects.js`
  - Features: Repository cloning, API queries, pull request management
  - Auth: GitHub personal access tokens stored in database (`user_credentials` table)
  - Token storage: User credentials table with credential_type='github_token'

- Git (CLI) - Local git operations
  - Integration: `server/routes/git.js`
  - Features: Status checks, diffs, commits, branches
  - Spawned as child process via cross-spawn

## Data Storage

**Databases:**
- SQLite (better-sqlite3)
  - Connection: `server/database/db.js`
  - Location: Configurable via `DATABASE_PATH` env var (default: `server/database/auth.db`)
  - Client: better-sqlite3 with prepared statements
  - Schema: `server/database/init.sql`

**Tables:**
- `users` - Single-user system with git config and onboarding status
- `api_keys` - External API keys for CLI/agent authentication
- `user_credentials` - Token storage for GitHub, GitLab, etc. (credential_type field)

**File Storage:**
- Local filesystem only - Projects and workspace data stored locally
- Project directory cache for fast lookups
- Session data stored in user's home directory (~/.claude/)

**Caching:**
- File system watcher (chokidar) - Monitors project directory for changes
- In-memory session tracking for active Claude/Codex/Cursor sessions
- Browser localStorage for:
  - JWT auth token (`auth-token`)
  - Theme preference (`theme`)
  - Task feature toggle (`tasks-enabled`)
  - Whisper mode preference (`whisperMode`)

## Authentication & Identity

**Auth Provider:**
- Custom single-user implementation
  - Implementation: `server/middleware/auth.js`, `server/routes/auth.js`
  - Password hashing: bcrypt with 12 salt rounds
  - Token type: JWT with configurable secret (`JWT_SECRET` env var)
  - Token storage: localStorage on client, verified on server
  - Persistence: SQLite users table

**Platform Mode:**
- Optional multi-user mode via `VITE_IS_PLATFORM=true` flag
- Bypasses local auth when enabled (expects external auth proxy)
- Useful for hosted deployments

**API Key Authentication:**
- Optional external API key mode for programmatic access
- Keys validated against `api_keys` table in database
- Pass via `X-API-Key` header or `apiKey` query parameter
- Used by `/api/agent/*` endpoints

## Monitoring & Observability

**Error Tracking:**
- None detected - errors logged to console/stderr

**Logs:**
- Console logging with ANSI color codes
- Structured logging in server routes
- Database query logging (console in development)
- Process output capture for spawned CLI processes

**Performance:**
- Vite with code splitting for frontend:
  - vendor-react chunk
  - vendor-codemirror chunk
  - vendor-xterm chunk
- Chunk size warning limit: 1000KB

## CI/CD & Deployment

**Hosting:**
- Self-hosted Node.js application
- Runs as Express server with embedded WebSocket server
- Static frontend assets served from `dist/` directory
- Production: `npm run build && npm run server`

**Package Management:**
- npm for dependency management
- Release-it 19.0.5 - Automated version bumping and releases
- Auto-changelog 2.5.0 - Changelog generation from commits
- Published to npm as @siteboon/claude-code-ui

**CLI Distribution:**
- Dual bin entry:
  - `claude-code-ui` - Primary command
  - `cloudcli` - Alias

## Environment Configuration

**Required env vars:**
- `JWT_SECRET` (production) - For secure token signing
- `OPENAI_API_KEY` (optional) - For Codex integration

**Optional env vars:**
- `PORT` - Backend port (default 3001)
- `VITE_PORT` - Frontend port (default 5173)
- `DATABASE_PATH` - Custom database location
- `CONTEXT_WINDOW` - Claude context limit (default 160000)
- `CLAUDE_TOOL_APPROVAL_TIMEOUT_MS` - Tool approval wait time
- `CLAUDE_CLI_PATH` - Custom Claude CLI path
- `SKIP_PROJECTS_PATTERN` - Project name filters
- `SKIP_LARGE_PROJECTS_MB` - Size-based project filtering
- `WORKSPACES_ROOT` - Custom workspace root
- `VITE_IS_PLATFORM` - Enable platform mode
- `API_KEY` - API key for protected endpoints

**Secrets location:**
- Database: SQLite file (stores API keys and tokens encrypted by better-sqlite3)
- Environment: `.env` file (loaded at server startup)
- Note: Passwords in database are bcrypt hashed
- GitHub tokens stored in plain text in `user_credentials` table - consider encryption in production

## Webhooks & Callbacks

**Incoming:**
- WebSocket connections for real-time command streaming
  - Path: `/ws` - WebSocket for command execution
  - Path: `/shell` - WebSocket for terminal emulation
  - Auth: JWT token passed via query parameter

**Outgoing:**
- Claude SDK tool execution callbacks for approval flow
  - Tool approval requests sent to UI via WebSocket
  - UI responds with approval/denial decision
- Potential GitHub webhooks for repository integration (not currently implemented)

## Real-time Communication

**WebSocket Server:**
- Library: ws 8.14.2
- Endpoints:
  - `/ws` - Claude/Codex command streaming with progress updates
  - `/shell` - Terminal emulation for interactive shell
- Message types:
  - `loading_progress` - Project loading status
  - Item events from Claude SDK (reasoning, tool calls, command output)
  - Tool approval requests
- Connection management: In-memory Set of connected clients for broadcast

---

*Integration audit: 2026-01-24*
