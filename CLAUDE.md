# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
# Development with hot reload
npm run dev

# Build for production
npm run build

# Start production server
npm start

# Individual services
npm run server    # Backend only
npm run client    # Frontend only (Vite dev server)
npm run preview   # Preview production build
```

## Project Architecture

### Core Structure
This is a full-stack React application providing a web UI for Claude Code and Cursor CLI:

- **Frontend**: React 18 + Vite + TailwindCSS + shadcn/ui components
- **Backend**: Express.js + WebSocket + SQLite database
- **Real-time**: WebSocket for chat, project updates, and shell communication
- **Authentication**: JWT-based auth with session management

### Key Directories
```
src/
├── components/          # React components (ChatInterface, FileTree, etc.)
├── contexts/           # React contexts (AuthContext, ThemeContext)  
├── hooks/              # Custom React hooks
├── utils/              # API helpers, WebSocket utilities
server/
├── routes/             # Express route handlers
├── database/           # SQLite database setup
├── middleware/         # Auth and other middleware
```

### Architecture Patterns

**Session Protection System**: The app tracks "active sessions" to prevent WebSocket project updates from interfering with ongoing conversations. When a user sends a message, the session is marked active and project updates are paused until the conversation completes.

**Dual CLI Support**: Supports both Claude Code CLI and Cursor CLI with dynamic switching through the UI.

**Mobile-First Design**: Responsive design with dedicated mobile navigation and PWA capabilities.

## Key Technologies

- **React**: Component state with hooks, React Router for routing
- **WebSocket**: Real-time communication via `/ws` and `/shell` endpoints  
- **SQLite**: Database with better-sqlite3 for session/auth storage
- **CodeMirror**: Advanced code editor with syntax highlighting
- **xterm.js**: Terminal emulator for shell integration
- **TailwindCSS**: Utility-first styling with custom design tokens
- **Vite**: Build tool with proxy configuration for API/WebSocket

## Environment Configuration

Copy `.env.example` to `.env` and configure:
- `PORT`: Backend server port (default: 3001)
- `VITE_PORT`: Frontend dev server port (default: 5173)

The backend serves static files in production and Vite handles development with proxy configuration.

## Database Schema

SQLite database (`store.db`) includes:
- User authentication tables
- Session management 
- Project metadata storage

Initialize with `npm run server` on first start.

## System Service Setup

The application is configured to run as a systemd service for automatic startup:

```bash
# Service management commands
sudo systemctl status claudecodeui    # Check status
sudo systemctl start claudecodeui     # Start service
sudo systemctl stop claudecodeui      # Stop service
sudo systemctl restart claudecodeui   # Restart service
sudo systemctl disable claudecodeui   # Disable startup
```

**Service Configuration**: Located at `/etc/systemd/system/claudecodeui.service`
- Runs as user `jay` in `/home/jay/claudecodeui`
- Automatically restarts on failure
- Uses full Node.js path from nvm: `/home/jay/.nvm/versions/node/v22.9.0/bin/npm`
- Accessible at http://localhost:5173/ (frontend) and http://localhost:3001/ (backend)

## Security Notes

- All Claude Code tools are disabled by default in the UI
- JWT authentication for API endpoints
- WebSocket authentication middleware
- File system operations are scoped to project directories
- Environment variables for sensitive configuration