# Claude Code UI - Technical Architecture

## Overview

Claude Code UI is a web-based interface for managing and viewing Claude Code CLI projects and conversation history. It also integrates Cursor AI Editor sessions, providing a unified project management experience.

## Core Architecture

### Tech Stack
- **Frontend**: React + Vite + Tailwind CSS
- **Backend**: Node.js + Express
- **Database**: SQLite (better-sqlite3)
- **WebSocket**: Real-time communication
- **File System**: Direct access to local Claude and Cursor data

## Project & Session Discovery

### 1. Claude Project Discovery

**Data Location**: `~/.claude/projects/`

```
~/.claude/projects/
├── C:-Users-sammy-Source-project-a/  # Path encoded
│   ├── session1.jsonl
│   └── session2.jsonl
└── C:-Users-sammy-Source-project-b/
    ├── session1.jsonl
    └── session2.jsonl
```

**Discovery Flow**:
1. Scan `~/.claude/projects/` directory
2. Folder name = encoded project path (`/` → `-`)
3. Extract real path from `cwd` field in `.jsonl` files
4. Smart path selection:
   - Single `cwd` → use directly
   - Multiple `cwd` → prefer most recent (usage ≥25%), otherwise most common

**Session Parsing** (`parseJsonlSessions`):
```javascript
// One JSON object per line
{"sessionId": "abc123", "cwd": "/real/path", "message": {...}, "timestamp": "..."}

// Generates session info
{
  id: "abc123",
  summary: "First user message preview..." || "New Session",
  messageCount: count,
  lastActivity: lastTimestamp,
  cwd: "/real/path"
}
```

### 2. Cursor Sessions Integration

**Data Location**: `~/.cursor/chats/`

```
~/.cursor/chats/
├── a1b2c3d4e5f6.../  # MD5 hash of project path
│   ├── session-id-1/
│   │   └── store.db  # SQLite database
│   └── session-id-2/
│       └── store.db
└── x7y8z9a0b1c2.../  # Another project
```

**Integration Flow**:
1. For each **known** Claude project path
2. Calculate MD5 hash: `crypto.createHash('md5').update(projectPath).digest('hex')`
3. Check if `~/.cursor/chats/{hash}/` exists
4. Read `store.db` (SQLite) for each session
5. Extract metadata from `meta` table:
   ```sql
   SELECT key, value FROM meta  -- hex-encoded JSON
   SELECT COUNT(*) as count FROM blobs  -- message count
   ```

### 3. Important Limitations

❌ **Cannot discover Cursor-only projects**:
- Cursor only stores MD5 hash of path, not the original path
- Cannot reverse-engineer project location from `~/.cursor/chats/`

❌ **Project relocation breaks history**:
- Path change → MD5 change → cannot find old sessions
- Requires manual re-association

✅ **Manual project addition**:
- Can manually add project paths via UI
- Stored in `~/.claude/project-config.json`
- Allows discovering Cursor sessions for projects without Claude sessions

## API Endpoint Architecture

### Project Management API
```javascript
GET  /api/projects                              // Get all projects
GET  /api/projects/:name/sessions               // Get project sessions (paginated)
GET  /api/projects/:name/sessions/:id/messages  // Get session messages
PUT  /api/projects/:name/rename                 // Rename project
DELETE /api/projects/:name/sessions/:id         // Delete session
DELETE /api/projects/:name                      // Delete empty project
POST /api/projects/create                       // Manually add project
```

### Core Implementation Functions

**`getProjects()`** - Project listing
1. Scan `~/.claude/projects/`
2. Extract real paths (`extractProjectDirectory`)
3. Load first 5 Claude sessions (`getSessions`)
4. Integrate Cursor sessions (`getCursorSessions`)
5. Add TaskMaster detection

**`getSessions(projectName, limit, offset)`** - Session pagination
1. Scan project directory for `.jsonl` files
2. Sort by modification time (newest first)
3. Parse all sessions (`parseJsonlSessions`)
4. Handle session continuation logic (leafUuid)
5. Return paginated results

**`getCursorSessions(projectPath)`** - Cursor integration
1. Calculate path MD5 hash
2. Check corresponding directory exists
3. Open SQLite database
4. Parse hex-encoded metadata
5. Return session list (limit 5)

## File Monitoring & Real-time Updates

### Project Monitoring
- Uses `chokidar` to watch `~/.claude/projects/`
- File changes → WebSocket notification to all clients
- Debounce to avoid frequent updates
- Auto-reload project list

### Session Protection
- Track "active sessions" to avoid mid-conversation updates
- User sends message → mark as active → pause project updates
- Conversation complete/aborted → mark as inactive → resume updates

## Terminal Interface Architecture

### Shell Integration
- **Technology**: xterm.js + node-pty
- **WebSocket**: Real-time terminal communication (`/shell` endpoint)
- **Session Management**: Persistent terminal sessions across tabs

### Virtual Keyboard
**Supported Buttons** (in order):
1. **ESC** - Send Escape key (`\x1b`)
2. **Left Arrow** - Send Left Arrow (`\x1b[D`)
3. **Up Arrow** - Send Up Arrow (`\x1b[A`)
4. **Down Arrow** - Send Down Arrow (`\x1b[B`)
5. **Right Arrow** - Send Right Arrow (`\x1b[C`)
6. **Backspace** - Send Backspace (`\x7f`)
7. **Enter** - Send Enter (`\r`)

**Implementation Details**:
- Correct ANSI escape sequence mapping
- Real-time button state feedback
- Touch-device friendly interface

### Voice Input Integration
- **Web Speech API**: Default speech-to-text
- **OpenAI Whisper**: Optional high-accuracy transcription
- **Dynamic Switching**: Auto-select based on API configuration

## Data Flow Architecture

```
User Interface (React)
    ↓ API calls
Express Server
    ↓ File system access
~/.claude/projects/        ~/.cursor/chats/
    ↓                          ↓
JSONL file parsing      SQLite database queries
    ↓                          ↓
    ←─── Session data integration ────→
            ↓
    WebSocket real-time updates
            ↓
    Frontend state update (React)

Terminal Data Flow:
User input/Virtual keyboard/Voice
    ↓ WebSocket
node-pty (pseudo-terminal)
    ↓ Execute command
Shell/Claude CLI
    ↓ Output return
xterm.js rendering
```

## Performance Optimization

### Caching Strategy
- **Project path cache**: `extractProjectDirectory` result caching
- **Session pagination**: Avoid loading all sessions at once
- **Early exit**: Partial file reading optimization for large projects

### File I/O Optimization
- Parallel reading of multiple `.jsonl` files
- SQLite read-only mode
- File modification time pre-sorting

## Security Considerations

### File System Access
- Restricted to `.claude` and `.cursor` under user home directory
- Path validation to prevent directory traversal attacks
- Error handling to avoid path disclosure

### Authentication
- JWT token authentication
- All API endpoints require authentication
- Session management and protection

## Known Issues & Limitations

1. **Cursor-only projects cannot be auto-discovered**
2. **Project path changes break historical associations**
3. **Performance concerns for large projects** (partially optimized)
4. **Cross-platform path encoding differences**

## Future Improvements

1. **Reverse-engineer Cursor project discovery**: Try to find project path clues from SQLite or other Cursor data
2. **Project path change detection**: Implement automatic re-association mechanism
3. **Performance optimization**: More advanced caching and indexing strategies
4. **Cross-AI tool integration**: Support for more AI editors and CLI tools
