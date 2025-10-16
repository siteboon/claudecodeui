# Claude Code UI - Architecture Documentation

Generated: 2025-10-13
Purpose: Foundation for slash commands implementation

## Technology Stack

### Backend
- **Node.js** with ES Modules (`"type": "module"`)
- **Express.js** v4.18.2 - Web framework
- **WebSocket (ws)** v8.14.2 - Real-time communication
- **Better-SQLite3** v12.2.0 - Session/message persistence
- **Authentication**: JWT (jsonwebtoken v9.0.2) + bcrypt v6.0.0
- **Process Management**:
  - node-pty v1.1.0-beta34 (terminal emulation)
  - cross-spawn v7.0.3 (process spawning)
- **Claude SDK**: @anthropic-ai/claude-agent-sdk v0.1.13

### Frontend
- **React** v18.2.0
- **Build Tool**: Vite v7.0.4
- **Styling**: TailwindCSS v3.4.0 + @tailwindcss/typography
- **Routing**: react-router-dom v6.8.1
- **Code Editor**: @uiw/react-codemirror v4.23.13
- **Markdown**: react-markdown v10.1.0
- **File Upload**: react-dropzone v14.2.3
- **Terminal**: @xterm/xterm v5.5.0 with WebGL addon

## Project Structure

```
claudecodeui/
├── server/
│   ├── index.js                 # Main server file (Express + WebSocket)
│   ├── claude-sdk.js            # Claude SDK wrapper
│   ├── cursor-cli.js            # Cursor CLI integration
│   ├── projects.js              # Project management utilities
│   ├── database/
│   │   └── db.js                # SQLite database initialization
│   ├── middleware/
│   │   └── auth.js              # JWT authentication & validation
│   ├── routes/
│   │   ├── auth.js              # Authentication endpoints
│   │   ├── cursor.js            # Cursor-specific routes
│   │   ├── git.js               # Git operations
│   │   ├── mcp.js               # MCP server management
│   │   ├── mcp-utils.js         # MCP utilities
│   │   └── taskmaster.js        # Task Master integration
│   └── utils/
│       ├── mcp-detector.js      # MCP server detection
│       └── taskmaster-websocket.js # Task Master WebSocket
├── src/
│   ├── components/
│   │   ├── ChatInterface.jsx    # Main chat component (2908 lines)
│   │   ├── TodoList.jsx         # Task display
│   │   ├── TokenUsagePie.jsx    # Token budget visualization
│   │   └── ... (other UI components)
│   ├── App.jsx                  # Root application
│   └── main.jsx                 # React entry point
├── dist/                        # Built frontend files
└── .taskmaster/                 # Task Master files
```

## API Endpoints (Express Routes)

### Authentication (`/api/auth`)
- POST `/api/auth/register` - User registration
- POST `/api/auth/login` - User login
- All other endpoints require JWT authentication

### Projects (`/api/projects`)
- GET `/api/projects` - List all projects
- GET `/api/projects/:projectName/sessions` - Get sessions for project
- GET `/api/projects/:projectName/sessions/:sessionId/messages` - Get messages
- POST `/api/projects/create` - Create new project
- GET `/api/projects/:projectName/file` - Read file content
- GET `/api/projects/:projectName/files` - List project files
- GET `/api/projects/:projectName/files/content` - Serve binary files
- POST `/api/projects/:projectName/upload-images` - Upload images

### Other APIs
- GET `/api/config` - Get WebSocket configuration
- GET `/api/browse-filesystem` - Browse filesystem for project selection
- POST `/api/transcribe` - Audio transcription
- GET `/api/sessions/:sessionId/token-usage` - Get token usage stats
- `/api/git/*` - Git operations (via git.js router)
- `/api/mcp/*` - MCP server management (via mcp.js router)
- `/api/cursor/*` - Cursor operations (via cursor.js router)
- `/api/taskmaster/*` - Task Master operations (via taskmaster.js router)
- `/api/mcp-utils/*` - MCP utilities (via mcp-utils.js router)

## WebSocket Architecture

### WebSocket Server Setup
- **Single WebSocket server** handling multiple paths
- **Authentication**: Token-based via query params or headers
- **Port**: Same as HTTP server (3001 default)
- **Connection verification** in `verifyClient` callback

### WebSocket Paths

#### 1. Chat WebSocket (`/ws`)
**Purpose**: Main chat communication with Claude
**Handler**: `handleChatConnection(ws)`

**Incoming Messages**:
- `type: 'claude-command'` - Send message to Claude SDK
  - `command`: User prompt
  - `options`: { sessionId, cwd, toolsSettings, permissionMode, images }
- `type: 'cursor-command'` - Send message to Cursor
- `type: 'abort-session'` - Abort active session

**Outgoing Messages**:
- `type: 'session-created'` - New session ID from backend
- `type: 'claude-response'` - Streaming response from Claude
  - `content`: Message content
  - `isComplete`: Boolean for stream end
  - `sessionId`: Current session ID
- `type: 'claude-complete'` - Session finished
- `type: 'session-aborted'` - Session aborted
- `type: 'error'` - Error occurred
- `type: 'token-budget'` - Token usage update
- `type: 'claude-status'` - Status updates during processing

#### 2. Shell WebSocket (`/shell`)
**Purpose**: Terminal emulation for interactive shells
**Handler**: `handleShellConnection(ws)`

**Features**:
- Interactive terminal using node-pty
- Supports PowerShell (Windows) and bash/zsh (Unix)
- Environment variable injection
- Real-time input/output streaming

## ChatInterface.jsx State Management

### Input & Chat State
```javascript
const [input, setInput] = useState('');                    // Current input text
const [chatMessages, setChatMessages] = useState([]);      // Chat history
const [isLoading, setIsLoading] = useState(false);         // Loading state
const [currentSessionId, setCurrentSessionId] = useState(null);
```

### File Attachment State
```javascript
const [showFileDropdown, setShowFileDropdown] = useState(false);
const [fileList, setFileList] = useState([]);              // Available files
const [filteredFiles, setFilteredFiles] = useState([]);    // Filtered by @ query
const [selectedFileIndex, setSelectedFileIndex] = useState(-1);
const [attachedImages, setAttachedImages] = useState([]);  // Image attachments
const [uploadingImages, setUploadingImages] = useState(new Map());
```

### Command State (Existing but Not Implemented)
```javascript
const [showCommandMenu, setShowCommandMenu] = useState(false);
const [slashCommands, setSlashCommands] = useState([]);
const [filteredCommands, setFilteredCommands] = useState([]);
const [selectedCommandIndex, setSelectedCommandIndex] = useState(-1);
const [slashPosition, setSlashPosition] = useState(-1);
```

### Other State
```javascript
const [permissionMode, setPermissionMode] = useState('default'); // Tool permissions
const [tokenBudget, setTokenBudget] = useState(null);      // Token usage tracking
const [claudeStatus, setClaudeStatus] = useState(null);     // Claude status display
const [provider, setProvider] = useState('claude');         // Claude vs Cursor
const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
```

### Key Refs
```javascript
const textareaRef = useRef(null);           // Input textarea
const scrollContainerRef = useRef(null);    // Messages container
const messagesEndRef = useRef(null);        // Auto-scroll target
```

## Input Handling Flow

### Current Implementation
1. **Input Change**: `handleInputChange(e)`
   - Updates input state
   - Tracks cursor position
   - Handles @ file mentions (existing)
   - **Slash commands NOT implemented**

2. **Submit**: `handleSubmit(e)`
   - Uploads images if attached
   - Creates user message
   - Sends via WebSocket as `claude-command` or `cursor-command`
   - Marks session as active

3. **File Mention (@)**
   - Detects `@` symbol in input
   - Shows dropdown with project files
   - Filters files by query
   - Keyboard navigation (Arrow keys, Enter, Escape)

## Authentication Flow

1. User logs in via `/api/auth/login`
2. Server returns JWT token
3. Token stored in localStorage as `'auth-token'`
4. All API requests include `Authorization: Bearer <token>` header
5. WebSocket connections include token in query params or headers
6. Middleware (`authenticateToken`, `authenticateWebSocket`) validates tokens

## Database Schema (SQLite)

### Tables
- `users` - User accounts (username, passwordHash)
- `sessions` - Chat sessions (id, userId, projectName, title, createdAt)
- `messages` - Chat messages (id, sessionId, role, content, timestamp)

## Missing Dependencies for Slash Commands

### Required npm Packages
- ✅ Already have: express, ws, react, react-dom
- ❌ Need to add: **gray-matter** (for frontmatter parsing in .md commands)
- ❌ Optional: **fuse.js** (for fuzzy search in command autocomplete)

## File System Conventions

### .claude/commands/ Structure
- Project-level commands at `.claude/commands/`
- User-level commands at `~/.claude/commands/`
- Commands are markdown files (`.md`)
- Can be organized in subdirectories
- Example: `.claude/commands/tm/next/next-task.md`

### Command File Format
```markdown
---
description: Command description
allowed-tools: [list, of, tools]
model: claude-3-5-sonnet-20241022
---

Command prompt content with:
- $ARGUMENTS for all args
- $1, $2 for positional args
- @filename for file includes
- !command for bash execution
```

## Integration Points for Slash Commands

### Backend
1. **New Router**: `server/routes/commands.js`
   - Mount at `/api/commands` in server/index.js
   - Add to protected routes with `authenticateToken`

2. **New Utility**: `server/utils/commandParser.js`
   - Parse markdown with gray-matter
   - Replace variables
   - Handle file includes
   - Execute bash commands safely

### Frontend
3. **ChatInterface.jsx Modifications**
   - Implement `handleInputChange` slash detection
   - Fetch commands on mount via `/api/commands/list`
   - Filter commands as user types
   - Show CommandMenu dropdown
   - Execute command on selection

4. **New Component**: `src/components/CommandMenu.jsx`
   - Dropdown UI for command autocomplete
   - Keyboard navigation (Arrow keys, Enter, Escape, Tab)
   - Mouse hover/click selection
   - Positioned near cursor

## Security Considerations

### Existing Security
- JWT authentication on all API endpoints
- Token validation in WebSocket connections
- Path traversal prevention in file operations
- bcrypt password hashing

### Additional for Commands
- Validate command paths (prevent directory traversal)
- Limit file include depth (max 3 levels)
- Timeout bash command execution (30 seconds)
- Allowlist for bash commands
- Validate file sizes for includes (<1MB)
- Rate limiting on command execution (10/minute)

## Performance Considerations

- Debounce command filtering (150ms recommended)
- Cache parsed commands in memory
- Virtual scrolling for >20 commands (react-window)
- Lazy load command files (only parse on execution)
- LocalStorage cache for command list per project

## Next Steps

1. ✅ **Task #1 Complete**: Architecture documented
2. **Task #2**: Create commands API router
3. **Task #3**: Implement command parser utility
4. **Task #4**: Build-in command handlers
5. **Task #5-8**: Frontend implementation
6. **Task #9**: MCP integration
7. **Task #10**: Testing & error handling
