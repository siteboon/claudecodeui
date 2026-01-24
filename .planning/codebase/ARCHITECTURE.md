# Architecture

**Analysis Date:** 2026-01-24

## Pattern Overview

**Overall:** Client-Server with Real-time Sync and Multi-Provider Integration

Claude Code UI is a full-stack application that aggregates AI coding sessions from multiple providers (Claude, Cursor, Codex) into a unified web interface. The architecture uses a separation-of-concerns pattern with React frontend communicating to Express backend via REST APIs and WebSockets for real-time updates.

**Key Characteristics:**
- **Multi-Provider Support:** Abstracts three different AI coding interfaces (Claude SDK, Cursor CLI, OpenAI Codex)
- **Real-time Project Updates:** WebSocket-driven project list synchronization with file system watching
- **Session Protection:** Prevents interrupting user conversations with background project updates
- **Monorepo-Aware:** Handles large projects through smart caching and memory optimization
- **Authentication Layers:** Supports both platform mode (external auth proxy) and self-hosted API key mode

## Layers

**Presentation Layer (Frontend - `/src`):**
- Purpose: React-based web UI for browsing projects, viewing sessions, and chatting with AI models
- Location: `src/`
- Contains: React components, hooks, contexts, utilities for UI state and API communication
- Depends on: WebSocket context for real-time updates, API utilities for REST calls, React contexts for global state
- Used by: Browser client, displays data fetched from backend

**API Layer (Backend - `/server/routes`):**
- Purpose: Express route handlers that orchestrate business logic and delegate to specialized modules
- Location: `server/routes/`
- Contains: 12+ route files handling auth, projects, sessions, git, MCP, TaskMaster, agents, etc.
- Depends on: Database layer, provider-specific modules (claude-sdk, cursor-cli, openai-codex), file system utilities
- Used by: Frontend API calls, agent endpoints, CLI integrations

**Provider Integration Layer (`/server`):**
- Purpose: Encapsulates communication with three different AI coding providers
- Location: `server/claude-sdk.js`, `server/cursor-cli.js`, `server/openai-codex.js`
- Contains: Provider-specific request/response handling, session management, model definitions
- Depends on: Node child processes, process management, provider SDKs/CLIs
- Used by: Route handlers (agent.js, commands.js, cursor.js, codex.js routes)

**Project Discovery & Management Layer (`/server/projects.js`):**
- Purpose: Discovers and catalogs Claude/Cursor projects from file system, handles project metadata
- Location: `server/projects.js`
- Contains: Project enumeration, session extraction from JSONL/SQLite, directory size calculations
- Depends on: File system (fs), readline for JSONL parsing, sqlite3 for Cursor session data, chokidar for watching
- Used by: Main server for WebSocket project broadcasts, route handlers for project operations

**Persistence Layer (`/server/database`):**
- Purpose: Stores authentication, user settings, API keys, and application metadata
- Location: `server/database/db.js`, `server/database/auth.db`
- Contains: SQLite database with users, API keys, GitHub tokens tables
- Depends on: better-sqlite3 driver
- Used by: Auth routes, API key validation, user/settings management

**File System Operations (`/server/utils`):**
- Purpose: Shared utilities for parsing commands, detecting MCPs, managing git config, WebSocket communication
- Location: `server/utils/`
- Contains: commandParser.js, mcp-detector.js, gitConfig.js, taskmaster-websocket.js
- Depends on: File system, child processes, parsing libraries
- Used by: Route handlers, project operations, MCP initialization

## Data Flow

**Project Discovery Flow:**

1. Server startup: `setupProjectsWatcher()` initializes chokidar watcher on `~/.claude/projects`
2. File change detected: Watcher fires debounced update
3. `getProjects()` called with `broadcastProgress` callback
   - Scans `~/.claude/projects` for project directories
   - Extracts project paths from `.jsonl` files (cwd field)
   - Computes directory sizes for memory optimization
   - Checks for Cursor sessions via MD5 hash lookup
   - Checks for Codex sessions
4. `broadcastProgress()` sends real-time update messages to all WebSocket clients
5. Frontend receives `projects_updated` message and refreshes project list
6. When project selected, `getSessions()` fetches sessions on-demand (paginated)

**Chat Session Flow:**

1. User selects project and session, clicks "Chat"
2. Frontend sends message via WebSocket: `{ type: 'chat', sessionId, message }`
3. Backend receives, marks session as active (Session Protection System)
4. Provider (Claude/Cursor/Codex) spawned with message as input
5. Provider responds with output streamed back to client
6. When complete, session marked inactive, project updates resume
7. Session files updated on disk (JSONL for Claude, SQLite for Cursor)

**File System Watcher Flow:**

1. `chokidar.watch()` monitors `~/.claude/projects` with debounce (100ms stability, 50ms poll)
2. Event buffered by `debouncedUpdate()` to prevent excessive reprocessing
3. Flag `isGetProjectsRunning` prevents reentrant calls
4. On stabilization: `clearProjectDirectoryCache()` flushes size calculations
5. `getProjects()` recalculates project list
6. WebSocket broadcast sends update to all connected clients

**State Management:**

- **Frontend Global State (React Contexts):**
  - `AuthContext`: User authentication status, token
  - `ThemeContext`: Dark/light mode preference
  - `WebSocketContext`: WebSocket connection and message handling
  - `TaskMasterContext`: TaskMaster project detection and task data
  - `TasksSettingsContext`: User-specific task display settings

- **Frontend Component State (App.jsx):**
  - `projects`: Array of projects
  - `selectedProject`, `selectedSession`: Current selection for chat
  - `activeSessions`: Set of session IDs with active conversations (prevents update interruption)
  - `processingSessions`: Set of session IDs currently thinking/processing
  - Local storage: User preferences (autoExpandTools, showThinking, sendByCtrlEnter, etc.)

- **Backend State:**
  - Database: Users, API keys, GitHub tokens
  - Memory: Connected WebSocket clients set
  - File system: Project configurations, session JSONL/SQLite files
  - Environment: Project filtering rules (SKIP_LARGE_PROJECTS_MB, SKIP_PROJECTS_PATTERN)

## Key Abstractions

**Provider Interface:**
- Purpose: Unified abstraction over three different AI providers
- Examples: `server/claude-sdk.js`, `server/cursor-cli.js`, `server/openai-codex.js`
- Pattern: Each exports functions like `query*()`, `abort*Session()`, `is*SessionActive()`, `getActive*Sessions()`
- Implementation: Claude uses SDK directly, Cursor/Codex spawn child processes

**Session Concept:**
- Purpose: Represents a single conversation thread across providers
- Manifestations:
  - Claude: `.jsonl` files in `~/.claude/projects/{encoded_path}/`
  - Cursor: SQLite databases in `~/.cursor/chats/{md5_hash}/sessions/`
  - Codex: Session objects stored in SDK
- Properties: sessionId, provider, project path, message history

**Project Abstraction:**
- Purpose: Groups sessions from potentially multiple providers for same codebase
- Examples: `src/components/ProjectCard.jsx`, `server/projects.js`
- Pattern: Project name encoded from path, maps to multiple session types
- Limitations: Cannot auto-discover Cursor-only projects (path not stored by Cursor)

**Model Constants:**
- Purpose: Single source of truth for supported model definitions
- Location: `shared/modelConstants.js`
- Used by: Frontend model selection UI, backend provider queries
- Structure: `CLAUDE_MODELS`, `CURSOR_MODELS`, `CODEX_MODELS` with OPTIONS arrays and DEFAULT values

**Authentication Abstraction:**
- Purpose: Supports two deployment modes seamlessly
- Mode 1 (Platform): External proxy handles auth, UI trusts request context
- Mode 2 (Self-hosted): API key validation via database
- Controlled by: `VITE_IS_PLATFORM` environment variable
- Implementation: Conditional logic in `server/routes/agent.js`, `src/utils/websocket.js`

## Entry Points

**Main Server (`server/index.js`):**
- Location: `server/index.js`
- Triggers: `npm run server` or `npm start`
- Responsibilities:
  - Express app initialization
  - Database setup
  - File watcher initialization
  - Route registration
  - WebSocket server setup
  - Static file serving
  - Request/response logging

**CLI Entry (`server/cli.js`):**
- Location: `server/cli.js`
- Triggers: `claude-code-ui` or `cloudcli` command
- Responsibilities:
  - Parse CLI arguments
  - Determine port, database path, host
  - Launch Express server
  - Display connection URLs

**Frontend Entry (`src/main.jsx`):**
- Location: `src/main.jsx`
- Triggers: Vite dev server or production build
- Responsibilities:
  - React app initialization
  - Clean up service workers
  - Render App component with providers

**Web UI (`src/App.jsx`):**
- Location: `src/App.jsx`
- Triggers: Browser load
- Responsibilities:
  - Route definition (chat, projects, settings)
  - Session management
  - WebSocket connection
  - Project/session selection state
  - Version checking
  - Session Protection System coordination

## Error Handling

**Strategy:** Defensive with graceful degradation

**Patterns:**
- Missing directories created automatically (e.g., `~/.claude` directory creation)
- ENOENT errors caught and handled with empty arrays returned
- Failed provider spawns logged but don't crash server
- Large files (>10MB) skipped with error messages instead of parsing
- WebSocket disconnections trigger automatic reconnection (3 second backoff)
- Database migrations run automatically on schema version mismatch
- Process cleanup on errors with explicit resource deallocation

**Examples:**
- `server/projects.js`: Wraps all file I/O in try-catch
- `src/utils/websocket.js`: Catches JSON parse errors on message receipt
- `server/index.js`: CLI argument parsing with environment variable fallbacks
- `server/routes/agent.js`: Validates API key before processing request

## Cross-Cutting Concerns

**Logging:**
- Backend: Console-based with ANSI color codes for visibility
- Frontend: Browser console
- No persistent logging system; application relies on console output

**Validation:**
- Frontend: Form validation in components (login, project creation)
- Backend: API key validation, token verification, request body parsing
- Shared: Model constants exported from `shared/modelConstants.js`

**Authentication:**
- JWT tokens for stateless frontend API calls
- Database-backed API keys for agent endpoints
- Environment-based platform mode bypass for proxy deployments

**Session Protection:**
- Frontend tracks `activeSessions` Set in App.jsx
- Backend respects session protection by checking `skipProjectUpdate` flag
- Prevents sidebar refresh during active chat to preserve UX
- Automatically deactivates when chat completes or aborts

**Memory Optimization:**
- Implemented in `server/projects.js` with multiple strategies
- `SKIP_LARGE_PROJECTS_MB`: Filter out large projects by size
- `SKIP_PROJECTS_PATTERN`: Exclude projects matching patterns
- Size calculations cache and skip common large directories (node_modules, .git, dist)
- Session parsing limited to first 5000 entries per file
- TaskMaster task parsing skips files >10MB

**Real-time Synchronization:**
- WebSocket broadcasts project updates to all connected clients
- File system watcher (chokidar) triggers updates on file changes
- Debounce prevents notification spam
- Clients receive `projects_updated` message with complete project list

---

*Architecture analysis: 2026-01-24*
