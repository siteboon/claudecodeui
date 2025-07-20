# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the web UI for Claude Code CLI - a React-based application that provides a graphical interface to interact with Claude Code sessions, manage projects, and execute commands. It consists of a Vite-powered React frontend and an Express.js backend that interfaces with the Claude CLI.

## Development Commands

```bash
# Install dependencies
npm install

# Run development server (frontend on port 3001, backend on port 3002)
npm run dev

# Build production assets
npm run build

# Start production server
npm start

# Run only the backend server
npm run server

# Run only the frontend dev server
npm run client
```

## Architecture

### Frontend Structure
- `/src/components/` - React components including ChatInterface, FileTree, GitPanel, Shell, etc.
- `/src/contexts/` - React contexts for AuthContext and ThemeContext
- `/src/hooks/` - Custom hooks for audio recording, version checking
- `/src/utils/` - API client, WebSocket manager, Whisper integration
- Uses Tailwind CSS with custom shadcn/ui components in `/src/components/ui/`

### Backend Structure
- `/server/index.js` - Main Express server with WebSocket setup
- `/server/routes/` - API endpoints for auth, git operations, MCP
- `/server/claude-cli.js` - Interface to spawn and manage Claude CLI processes
- `/server/database/` - SQLite database for authentication and settings
- Uses node-pty for terminal emulation and process management

### Key Integration Points
1. **WebSocket Communication** - Real-time updates between frontend and backend for chat, file changes, and terminal output
2. **Claude CLI Process** - Backend spawns Claude CLI as child process and manages stdio communication
3. **File System Access** - Backend provides controlled access to project files through API endpoints
4. **Authentication** - JWT-based auth with bcrypt password hashing stored in SQLite

## Important Considerations

1. **Security** - Tools are disabled by default. The backend validates all file operations and restricts access to project directories.

2. **Environment Variables**:
   - `VITE_PORT` - Frontend dev server port (default: 3001)
   - `PORT` - Backend server port (default: 3002)
   - `JWT_SECRET` - Required for production deployment
   - `NODE_ENV` - Set to 'production' for production builds

3. **PWA Support** - Includes service worker and manifest for offline capabilities and mobile installation

4. **Real-time Features** - Heavy use of WebSockets for live updates. Ensure proper connection handling and reconnection logic.

5. **Process Management** - The backend spawns Claude CLI processes. Handle process lifecycle, cleanup, and error states properly.

## Common Development Tasks

- When modifying the chat interface, test with both desktop and mobile viewports
- WebSocket changes require testing reconnection scenarios
- File tree operations should preserve the current expansion state
- Git panel changes need to handle various git states (clean, dirty, conflicts)
- Terminal component uses xterm.js - test on different shells and platforms