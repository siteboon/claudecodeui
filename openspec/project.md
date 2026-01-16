# Project Context

## Purpose

Claude Code UI (aka Cloud CLI) is a full-stack web application that provides a responsive desktop and mobile interface for [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code), [Cursor CLI](https://docs.cursor.com/en/cli/overview), and [OpenAI Codex](https://developers.openai.com/codex). It enables users to interact with their AI programming assistants from any device through a browser, providing a seamless cross-device experience for AI-powered development workflows.

**Key Goals:**
- Provide universal access to AI CLI tools from any device (desktop, tablet, mobile)
- Enable real-time chat and terminal interactions with AI assistants
- Offer integrated file browsing, code editing, and Git operations
- Support session management and conversation resumption
- Maintain security through authentication and tool permission systems

## Tech Stack

### Frontend
- **React 18** - Functional components with hooks
- **Vite 7** - Fast build tool with hot module replacement
- **React Router v6** - Client-side routing
- **Tailwind CSS 3** - Utility-first styling with custom components
- **CodeMirror 6** - Code editing with syntax highlighting (JavaScript, Python, JSON, Markdown, CSS, HTML)
- **Xterm.js 5** - Terminal emulation with WebGL rendering
- **React Markdown** - Markdown rendering with KaTeX math support
- **Lucide React** - Icon library

### Backend
- **Node.js** (v20+) - ES modules (type: "module")
- **Express.js 4** - REST API server
- **WebSocket (ws 8)** - Real-time bidirectional communication
- **SQLite (better-sqlite3 12)** - Embedded database for users, sessions, settings
- **JWT (jsonwebtoken 9)** - Authentication tokens
- **bcrypt 6** - Password hashing
- **node-pty 1** - Pseudo-terminal for shell sessions

### AI SDKs
- **@anthropic-ai/claude-agent-sdk 0.1.x** - Direct Claude integration
- **@openai/codex-sdk 0.75.x** - OpenAI Codex integration
- **child process spawning** - Cursor CLI integration

### DevOps
- **concurrently** - Run frontend and backend in parallel
- **Vite** - Build system with manual chunk splitting
- **auto-changelog** - Automated CHANGELOG generation
- **release-it** - Release automation

### Database
- **SQLite** with three main tables:
  - `users` - Authentication and user settings
  - `api_keys` - External API key management
  - `user_credentials` - Stored service credentials (GitHub, GitLab, etc.)

## Project Conventions

### Code Style

#### JavaScript/React (Frontend)
- **ES Modules** - All imports use `.js` or `.jsx` extensions explicitly
- **Functional Components** - React components are functional with hooks (no class components)
- **File Naming**:
  - Components: PascalCase (e.g., `ChatInterface.jsx`, `Settings.jsx`)
  - Utilities: camelCase (e.g., `api.js`, `websocket.js`)
  - Hooks: camelCase with `use` prefix (e.g., `useAudioRecorder.js`, `useLocalStorage.jsx`)
- **Imports**: Organized in groups (React, third-party, relative imports)
- **JSX**: Single quotes for attributes, double quotes for strings
- **Component Organization**:
  - Hooks at top level
  - Event handlers after hooks
  - Render helpers at bottom
  - Main render return at end

#### JavaScript (Backend)
- **ES Modules** - All files use `.js` extension with import/export
- **Async/Await** - Preferred over callbacks for async operations
- **Error Handling** - Try-catch blocks for file I/O, process spawning, database operations
- **Comments**: JSDoc-style for modules and key functions
- **Constants**: UPPER_SNAKE_CASE (e.g., `TOOL_APPROVAL_TIMEOUT_MS`, `CONTEXT_WINDOW`)

#### Code Comments
- **Block comments** (`/* */`) for file headers and complex logic explanations
- **Line comments** (`//`) for inline explanations
- **TODO/FIXME** markers for pending work
- **Session Protection comments** use multi-line header format for critical integration points

### Architecture Patterns

#### Frontend Architecture
- **Component Hierarchy**: `App.jsx` → Context Providers → Page Components → UI Components
- **Context-based State Management**:
  - `AuthContext` - User authentication state
  - `WebSocketContext` - WebSocket connection management
  - `ThemeContext` - Dark/light mode
  - `TaskMasterContext` - Task management state
  - `TasksSettingsContext` - Task settings persistence
- **Custom Hooks** for reusable logic (e.g., `useAudioRecorder`, `useLocalStorage`)
- **Protected Routes** - `ProtectedRoute` component wraps authenticated pages
- **Error Boundaries** - `ErrorBoundary` wraps main app for graceful failure

#### Backend Architecture
- **Express Middleware Chain**:
  1. CORS (cross-origin requests)
  2. JSON body parser
  3. JWT authentication (`middleware/auth.js`)
  4. Route handlers
- **Modular Routes** - Each feature has its own router in `routes/` directory
- **Session Management**:
  - In-memory `activeSessions` Maps per provider (Claude, Cursor, Codex)
  - PTY sessions cached in `ptySessionsMap` with 30-minute timeout
  - Session resumption via `sessionId` parameter
- **WebSocket Handlers**:
  - `/ws` - Chat and AI assistant communication
  - `/shell` - Terminal/shell access with PTY spawning
- **Error Handling**:
  - Path validation prevents directory traversal
  - Try-catch wrapping for process spawning
  - WebSocket errors logged but don't crash server

#### Communication Patterns
- **REST API** - Standard HTTP methods for CRUD operations
- **WebSocket Message Flow**:
  1. Client sends command with options (projectPath, sessionId, etc.)
  2. Server invokes SDK/CLI integration
  3. Responses streamed via `writer.send()` with message type markers
  4. UI renders based on message type (content, tool_use, error, etc.)
- **Message Types**: `claude-command`, `cursor-command`, `codex-command`, `abort-session`, `claude-permission-response`

### Testing Strategy

**Current Status**: No formal test suite exists. Manual testing focuses on:
- Multi-provider session management (Claude, Cursor, Codex)
- WebSocket connection reliability
- File operations security
- Terminal session persistence
- Cross-device responsiveness

**Testing Guidelines** (for future tests):
- Test WebSocket reconnection scenarios
- Verify file system path validation (directory traversal prevention)
- Test tool permission approval flows
- Validate session resumption across providers
- Test concurrent sessions and PTY cleanup
- Verify database migrations and schema changes

### Git Workflow

#### Branching Strategy
- **main** - Production-ready code, always deployable
- **feature/*** - New features (e.g., `feat/show-grant-permission-button`)
- **fix/*** - Bug fixes (e.g., `fix/server-crash-when-opening-settings`)
- **Merge commits** - Pull requests merged with merge commits (not rebase)

#### Commit Message Conventions
Based on recent commit history:
- **feat:** - New features (e.g., "feat: add Bash command approval handling")
- **fix:** - Bug fixes (e.g., "fix: normalize file path handling")
- **Merge pull request #XXX** - PR merges (automated)
- **Merge branch** - Branch merges (automated)

**Commit Message Format**:
```
type: brief description

Optional detailed explanation with multiple lines.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>
```

#### Release Process
1. Update version in `package.json`
2. Run `npm run release` (triggers `release-it`)
3. Auto-generated CHANGELOG via `auto-changelog`
4. Tag and push to GitHub repository

## Domain Context

### AI CLI Tools Integration

#### Claude Code
- **Session Location**: `~/.claude/projects/[encoded-path]/`
- **Models**: Claude Sonnet 4.5, Opus 4.5 (see `shared/modelConstants.js`)
- **Tool Permissions**: All tools **disabled by default** for security
- **Approval Timeout**: 55 seconds (configurable via `CLAUDE_TOOL_APPROVAL_TIMEOUT_MS`)
- **SDK Integration**: Direct SDK usage (no child processes) for better performance

#### Cursor CLI
- **Session Location**: `~/.cursor/projects/`
- **Integration**: Child process spawning (`cursor-agent` command)
- **Resume Support**: `--resume` parameter for session continuation

#### OpenAI Codex
- **Session Location**: `~/.codex/sessions/` (JSONL format)
- **Token Usage**: Tracked and displayed in UI
- **Integration**: `@openai/codex-sdk` with session file parsing

### Project Discovery
Projects auto-discovered from provider-specific directories using:
- `extractProjectDirectory()` - Resolves encoded project paths
- `getFileTree()` - Generates file tree structure for browsing
- `chokidar` - File watcher for live updates

### File System Security
All file operations validate paths are within project root:
```javascript
const normalizedRoot = path.resolve(projectRoot) + path.sep;
if (!resolved.startsWith(normalizedRoot)) {
    return res.status(403).json({ error: 'Path must be under project root' });
}
```

### Session Protection System
Prevents sidebar project updates from interrupting active chat sessions:
- User sends message → Session marked as **active**
- Claude completes → Session marked as **inactive**
- Session aborted → Session marked as **inactive**
- App.jsx pauses sidebar updates when session is **active**

## Important Constraints

### Technical Constraints
- **Node.js Version**: Minimum v20 required (ES modules, crypto.randomUUID())
- **Single User System**: Database designed for single-user instance (not multi-tenant)
- **In-Memory State**: Active sessions and tool approvals don't persist across restarts
- **No Native Notifications**: Uses in-app UI for all alerts
- **Tool Approval Timeout**: Must be < 60s (SDK control timeout limit)

### Security Constraints
- **Path Traversal Protection**: All file paths validated against project root
- **Tool Permissions**: Opt-in model (all tools disabled by default)
- **Authentication**: JWT-based with bcrypt password hashing
- **API Key Management**: Stored in database with user association
- **WebSocket Security**: Same-origin policy, no CORS on WebSocket routes

### Performance Constraints
- **Context Window**: Default 160,000 tokens (configurable via `CONTEXT_WINDOW`)
- **Chunk Size**: Vite build warns at 1000KB chunks
- **PTY Session Cache**: 30-minute timeout to prevent memory leaks
- **Database**: SQLite (not suitable for high-concurrency multi-user scenarios)

### Business Constraints
- **Provider Dependency**: Requires external CLI tools to be installed separately
- **Single Instance Design**: Not designed for hosted multi-tenant deployments
- **No Native Mobile Apps**: Web-only (can be wrapped in PWA, but not native)
- **Open Source MIT License**: Free to use, modify, and distribute

## External Dependencies

### Required CLI Tools (User-Installed)
- **Claude Code CLI** - `npm install -g @anthropic-ai/claude-code`
- **Cursor CLI** - Installed via Cursor IDE
- **OpenAI Codex CLI** - `npm install -g @openai/codex`

### NPM Dependencies
**Runtime** (production):
- Web framework: `express`, `react`, `react-dom`, `react-router-dom`
- Real-time: `ws`, `@xterm/xterm`, `node-pty`
- Database: `better-sqlite3`, `sqlite3`
- Auth: `jsonwebtoken`, `bcrypt`
- AI SDKs: `@anthropic-ai/claude-agent-sdk`, `@openai/codex-sdk`
- UI: `@uiw/react-codemirror`, `lucide-react`, `tailwindcss`
- Utilities: `chokidar`, `fuse.js`, `gray-matter`, `katex`

**Development**:
- Build: `vite`, `@vitejs/plugin-react`, `concurrently`
- Release: `release-it`, `auto-changelog`
- Image processing: `sharp`

### External Services
- **GitHub API** - Via `@octokit/rest` for Git operations
- **OpenAI API** - Optional Whisper transcription (requires `OPENAI_API_KEY`)
- **MCP Servers** - User-configurable Model Context Protocol servers

### Environment Variables
```bash
PORT=3001                              # Backend server port
VITE_PORT=5173                         # Frontend dev server port
CONTEXT_WINDOW=160000                  # Claude context size
CLAUDE_TOOL_APPROVAL_TIMEOUT_MS=55000  # Tool approval timeout
OPENAI_API_KEY=                        # Whisper transcription key
VITE_IS_PLATFORM=false                 # Platform mode flag
```

### Repository Information
- **Homepage**: https://claudecodeui.siteboon.ai
- **Repository**: https://github.com/siteboon/claudecodeui
- **Issues**: https://github.com/siteboon/claudecodeui/issues
- **Package**: `@siteboon/claude-code-ui` on npm