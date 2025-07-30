# Claude Code UI - Complete Documentation

## Overview
Claude Code UI is a full-featured web interface for Anthropic's Claude Code CLI, providing a desktop and mobile-friendly UI for managing AI-assisted coding sessions.

## Key Features

### 1. **Project Management**
- Automatically discovers and displays all Claude Code projects from `~/.claude/projects/`
- Visual project browser with metadata and session counts
- Project actions: rename, delete, organize
- Real-time project synchronization via WebSocket

### 2. **Chat Interface**
- Real-time streaming responses from Claude
- Session persistence and history
- Support for:
  - Text messages
  - Code blocks with syntax highlighting
  - File attachments via drag-and-drop
  - Voice input with Whisper transcription
  - Image uploads and viewing
- Message history with timestamps
- Todo list integration for task tracking

### 3. **File Explorer**
- Interactive file tree browser
- Built-in code editor with syntax highlighting (CodeMirror)
- File operations:
  - Create new files/directories
  - Edit existing files
  - Delete files/directories
  - Real-time file watching
- Support for multiple languages (JS, Python, HTML, CSS, JSON, Markdown)

### 4. **Git Integration**
- View git status and changes
- Stage/unstage files
- Commit changes
- Switch branches
- View commit history
- Push/pull operations
- Git diff viewer

### 5. **Session Management**
- Resume previous conversations
- Create new sessions
- Session organization by project
- Export conversation history
- Session protection during active chats (prevents interruptions)

### 6. **Shell Terminal**
- Direct access to Claude Code CLI
- Full terminal emulation (xterm.js)
- WebGL rendering for performance
- Clipboard integration
- Responsive terminal sizing

### 7. **Tools & Security**
- All Claude Code tools disabled by default
- Granular tool permission management
- Local settings persistence
- JWT authentication system

### 8. **Mobile Support**
- Responsive design for all screen sizes
- Touch-friendly interface
- Swipe gestures
- Bottom navigation bar
- PWA support (installable as app)

## Architecture

### Frontend (React + Vite)
```
src/
├── components/
│   ├── ChatInterface.jsx      # Main chat UI
│   ├── FileTree.jsx          # File explorer
│   ├── GitPanel.jsx          # Git operations
│   ├── Shell.jsx             # Terminal emulator
│   ├── Sidebar.jsx           # Project/session browser
│   ├── TodoList.jsx          # Task management
│   └── ToolsSettings.jsx     # Security settings
├── contexts/
│   ├── AuthContext.jsx       # Authentication state
│   └── ThemeContext.jsx      # Dark mode support
├── hooks/
│   ├── useAudioRecorder.js   # Voice recording
│   └── useVersionCheck.js    # Update notifications
└── utils/
    ├── api.js                # HTTP API client
    ├── websocket.js          # WebSocket client
    └── whisper.js            # Audio transcription
```

### Backend (Node.js + Express)
```
server/
├── index.js                  # Main server
├── claude-cli.js            # Claude CLI integration
├── projects.js              # Project management
├── database/
│   └── db.js               # SQLite for auth
└── routes/
    ├── auth.js             # Authentication
    ├── git.js              # Git operations
    └── mcp.js              # MCP server integration
```

## API Endpoints

### Projects
- `GET /api/projects` - List all projects
- `GET /api/projects/:id` - Get project details
- `DELETE /api/projects/:id` - Delete project
- `PUT /api/projects/:id/rename` - Rename project

### Sessions
- `GET /api/sessions/:projectId` - List sessions
- `GET /api/sessions/:projectId/:sessionId/messages` - Get messages
- `DELETE /api/sessions/:projectId/:sessionId` - Delete session
- `PUT /api/sessions/:projectId/:sessionId/rename` - Rename session

### Files
- `GET /api/files/:projectId/*` - Read file
- `PUT /api/files/:projectId/*` - Write file
- `DELETE /api/files/:projectId/*` - Delete file
- `POST /api/files/:projectId/mkdir/*` - Create directory

### Git
- `GET /api/git/:projectId/status` - Git status
- `POST /api/git/:projectId/stage` - Stage files
- `POST /api/git/:projectId/commit` - Commit changes
- `GET /api/git/:projectId/branches` - List branches
- `POST /api/git/:projectId/checkout` - Switch branch

### WebSocket Events
- `chat` - Send message to Claude
- `abort` - Abort current request
- `refreshProjects` - Request project update
- `claude-response` - Streaming response
- `session-created` - New session created
- `claude-complete` - Response finished

## Configuration

### Environment Variables (.env)
```bash
# Backend server port
PORT=3008

# Frontend dev server port  
VITE_PORT=3009
```

### User Settings (localStorage)
- `claude_ui_tools` - Enabled tools configuration
- `claude_ui_theme` - Dark/light theme preference
- `claude_ui_token` - Authentication JWT
- `chat_messages_[sessionId]` - Cached messages

## Security Features

1. **Tool Permissions**: All tools disabled by default, require explicit enabling
2. **Authentication**: JWT-based auth with bcrypt password hashing
3. **File Access**: Restricted to project directories only
4. **WebSocket Security**: Token-based authentication required
5. **Input Validation**: Sanitization of file paths and user inputs

## Session Protection System

The app implements a sophisticated session protection mechanism:

1. **Problem**: WebSocket project updates would refresh UI during active chats
2. **Solution**: Track "active sessions" and pause updates during conversations
3. **Implementation**:
   - Mark session active when user sends message
   - Skip project updates while session active
   - Resume updates when conversation completes/aborts
   - Handles both existing and temporary session IDs

## Mobile PWA Features

- Service worker for offline caching
- App manifest for installation
- Touch-optimized UI components
- Viewport meta tags for proper scaling
- Apple-specific PWA enhancements

## Performance Optimizations

1. **React Optimizations**:
   - Memoized components with React.memo
   - useCallback for event handlers
   - useMemo for expensive computations
   - Virtualized lists for large file trees

2. **WebSocket Efficiency**:
   - Message batching
   - Automatic reconnection
   - Binary data support

3. **File Operations**:
   - Streaming for large files
   - Debounced file watching
   - Lazy loading of file contents

## Limitations

1. Requires Claude Code CLI to be installed and configured
2. File operations limited to project directories
3. No multi-user support (single user auth)
4. Git operations require git to be installed
5. Voice input requires browser WebRTC support

## Usage Tips

1. **First Time Setup**:
   - Install Claude Code CLI first
   - Run `claude` in at least one project directory
   - Start the UI and enable needed tools

2. **Performance**:
   - Use Chrome/Edge for best terminal performance
   - Enable WebGL for terminal rendering
   - Keep chat history under 50 messages

3. **Mobile Usage**:
   - Add to home screen for app-like experience
   - Use landscape mode for better file editing
   - Swipe between chat and files on mobile

## Troubleshooting

1. **Empty Project List**: Ensure Claude CLI is installed and `~/.claude/projects/` exists
2. **WebSocket Errors**: Check if ports 3008/3009 are available
3. **File Permission Errors**: Verify project directory permissions
4. **Git Errors**: Ensure git is installed and project is a git repository