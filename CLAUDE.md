# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claude Code UI is a web-based interface for the Claude Code CLI, providing a desktop and mobile-friendly UI for managing AI-assisted coding sessions. It integrates directly with the Claude CLI process and provides real-time updates via WebSockets.

## Memory Organization

This project uses modular memory organization for better context awareness:

@./docs/coding-standards.md
@./docs/architecture-patterns.md
@./server/CLAUDE.md
@./src/CLAUDE.md

### How Memory Works
- Claude reads CLAUDE.md files recursively from current directory upward
- Specialized memory files provide context for specific areas
- Imports allow modular organization without duplication
- Update relevant memory files when adding new patterns or features

## Development Commands

```bash
# Install dependencies
npm install

# Development (runs both frontend and backend)
npm run dev

# Run backend only (port 3008)
npm run server

# Run frontend only (port 3009) 
npm run client

# Production build
npm run build

# Build and serve production
npm start
```

## Architecture

### Backend (`server/`)
- **Express server** on port 3008 (configurable via `PORT` env var)
- **WebSocket server** for real-time updates to connected clients
- **Claude CLI integration** via `server/claude-cli.js` - spawns and manages Claude processes
- **Project management** via `server/projects.js` - reads from `~/.claude/projects/`
- **Git operations** via `server/routes/git.js` - provides git status, diff, log, etc.

### Frontend (`src/`)
- **React 18** with Vite dev server on port 3009
- **WebSocket client** (`src/utils/websocket.js`) for real-time updates
- **Session Protection System** in `App.jsx` - prevents WebSocket updates from interrupting active conversations
- **Theme system** via `ThemeContext` with CSS variables for dark/light modes
- **Mobile-responsive** with adaptive layouts at 768px breakpoint

### Key Components
- `ChatInterface.jsx` - Main chat UI with Claude, handles message streaming
- `CodeEditor.jsx` - CodeMirror integration with syntax highlighting
- `FileTree.jsx` - Interactive file explorer for project files
- `GitPanel.jsx` - Git integration UI
- `Shell.jsx` - xterm.js terminal interface with WebGL acceleration

## Important Implementation Details

### Session Protection System
The app implements a session protection mechanism to prevent WebSocket updates from interrupting active conversations:
- When a conversation is active, the UI shows a "Session Protection Active" indicator
- Background updates are queued but not applied until protection is disabled
- This preserves object references to prevent React re-renders during chats

### Security Considerations
- All Claude Code tools are **disabled by default** and must be manually enabled via the UI
- File operations are scoped to project directories only
- The backend validates all file paths to prevent directory traversal

### WebSocket Protocol
- Clients connect to `/ws` endpoint
- Server broadcasts project updates when files change in `~/.claude/projects/`
- Messages include project lists, session updates, and chat messages

### Project Directory Resolution
The `extractProjectDirectory` function in `server/projects.js` determines the actual project directory by:
1. Checking for explicit directory in project config
2. Falling back to the project name as directory
3. Caching results for performance

## Configuration

Environment variables (create `.env` from `.env.example`):
- `PORT` - Backend server port (default: 3008)
- `VITE_PORT` - Frontend dev server port (default: 3009)

## Common Tasks

### Adding a new API endpoint
1. Create route handler in `server/routes/`
2. Import and use in `server/index.js`
3. Update frontend API calls to use the new endpoint

### Modifying the chat interface
- Main logic in `src/components/ChatInterface.jsx`
- Message streaming handled via WebSocket in `handleSendMessage`
- UI updates preserve conversation state during active sessions

### Working with the file explorer
- File tree component in `src/components/FileTree.jsx`
- File operations go through `/api/files/*` endpoints
- Syntax highlighting via CodeMirror language modes

## Testing Approach
Currently no automated tests exist. When implementing tests:
- Use the testing framework of your choice (Jest, Vitest, etc.)
- Focus on critical paths: session management, file operations, WebSocket communication
- Mock the Claude CLI integration for unit tests

## Quick Reference - Key Functions

### Session Management
- `markSessionAsActive()` - App.jsx:234
- `markSessionAsInactive()` - App.jsx:244
- `spawnClaude()` - server/claude-cli.js:10
- `extractProjectDirectory()` - server/projects.js:237

### WebSocket Handlers
- `handleChatConnection()` - server/index.js:423
- `handleShellConnection()` - server/index.js:464
- `useWebSocket()` - src/utils/websocket.js:3

### Critical Components
- Session Protection System - App.jsx:234-261
- Message Streaming - ChatInterface.jsx:122-199
- File Tree Navigation - FileTree.jsx:15-120
- Terminal Integration - Shell.jsx:20-150