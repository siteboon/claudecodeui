# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
# Development (runs both frontend and backend with hot reload)
npm run dev

# Build frontend for production
npm run build

# Start production server (builds first, then runs server)
npm start

# Run server only (without building frontend)
npm run server

# Run frontend dev server only
npm run client
```

## Architecture Overview

### Stack
- **Frontend**: React 18 + Vite, Tailwind CSS, CodeMirror for code editing, xterm.js for terminal
- **Backend**: Express.js with WebSocket support (ws library)
- **Database**: SQLite (better-sqlite3) for auth/users/API keys
- **CLI Integration**: Spawns Claude Code CLI or Cursor CLI processes via node-pty

### Key Directories
```
server/           # Express backend
  index.js        # Main server entry, WebSocket setup, route registration
  routes/         # API routes (auth, projects, git, agent, coolify, etc.)
  database/       # SQLite database and migrations
  middleware/     # Auth middleware (JWT-based)

src/              # React frontend
  components/     # UI components (Sidebar, ChatInterface, Shell, etc.)
  contexts/       # React contexts (Auth, WebSocket, Theme, TaskMaster)
  utils/          # API client, helpers
```

### Core Data Flow
1. **Chat/Agent Mode**: Frontend connects via WebSocket → Backend spawns Claude CLI process → Streams responses back
2. **Shell Mode**: Frontend xterm.js → WebSocket → node-pty spawns bash/CLI → bidirectional terminal I/O
3. **Projects**: Discovered from `~/.claude/projects/` (Claude) or user-added directories

### Key Integrations

#### Coolify Integration (Self-hosted Deployment Platform)
The app integrates with Coolify to view/manage deployments directly from the UI.

**Files:**
- `server/routes/coolify.js` - Backend API proxy to Coolify
- `src/components/CoolifySidebar.jsx` - Hierarchical project/env/app tree view
- `src/components/CoolifyDeployButton.jsx` - One-click deploy (commit + push)
- `src/utils/api.js` - Frontend API client (see `api.coolify.*` methods)

**Backend API Pattern (`server/routes/coolify.js`):**
```javascript
// All Coolify API calls go through coolifyFetch() which:
// 1. Reads COOLIFY_API_URL and COOLIFY_API_TOKEN from env
// 2. Adds Authorization header
// 3. Validates JSON response (prevents HTML error page crashes)
async function coolifyFetch(endpoint, options = {})

// Existing endpoints:
GET  /api/coolify/status      - Check connection
GET  /api/coolify/projects    - List projects
GET  /api/coolify/applications - List all apps
GET  /api/coolify/hierarchy   - Full tree: projects → environments → apps
GET  /api/coolify/app/:uuid   - Single app details
POST /api/coolify/clone       - Clone app repo locally (uses SSH if available)
POST /api/coolify/deploy/:uuid - Commit + push (triggers Coolify webhook)
```

**Coolify API Reference:** The backend proxies to Coolify's REST API at `{COOLIFY_API_URL}/api/v1/...`
- Projects: `/projects`, `/projects/{uuid}`
- Applications: `/applications`, `/applications/{uuid}`
- Deployments: `/applications/{uuid}/deployments`
- Logs: `/applications/{uuid}/logs` (for deployment logs)
- Create resources: POST to `/projects`, `/applications`, etc.

**Adding New Coolify Features:**
1. Add backend route in `server/routes/coolify.js` using `coolifyFetch()`
2. Add API method in `src/utils/api.js` under `coolify: { ... }`
3. Add UI component/button in `CoolifySidebar.jsx` or create new component
4. Handle loading/error states (Coolify may be unavailable)

**Environment Variables:**
- `COOLIFY_API_URL` - Coolify server URL (not `COOLIFY_URL` - that's reserved by Coolify)
- `COOLIFY_API_TOKEN` - API token from Coolify dashboard

#### Other Integrations
- **TaskMaster AI**: Optional task management integration
- **MCP Servers**: Model Context Protocol server support

### Authentication
- JWT-based auth with bcrypt password hashing
- Single-user system with hardcoded default credentials on first run
- API keys supported for programmatic access

### WebSocket Endpoints
- `/ws` - Main WebSocket for chat, terminal, and project updates
- Chat messages, terminal I/O, and project refresh all go through this connection

## Environment Variables

```bash
PORT=3001                    # Server port
DATABASE_PATH=               # Custom SQLite database location
COOLIFY_API_URL=             # Coolify server URL (for Coolify integration)
COOLIFY_API_TOKEN=           # Coolify API token
OPENAI_API_KEY=              # For voice transcription
CONTEXT_WINDOW=160000        # Claude context window size
```

## Frontend Patterns

### Sidebar Component Structure
The sidebar (`src/components/Sidebar.jsx`) has tab-based navigation:
- **Projects tab**: Local projects from `~/.claude/projects/`
- **Coolify tab**: Remote Coolify apps (renders `CoolifySidebar.jsx`)

To add new sidebar sections, follow the tab pattern in `Sidebar.jsx`.

### API Client Pattern
All API calls go through `src/utils/api.js`. Pattern for adding new endpoints:
```javascript
// In src/utils/api.js
export const api = {
  coolify: {
    getHierarchy: () => fetchWithAuth('/api/coolify/hierarchy'),
    // Add new methods here
  }
};
```

### Component Conventions
- Use Tailwind CSS for styling
- Use `lucide-react` for icons
- Loading states: Use `Loader2` icon with `animate-spin`
- Error states: Show inline error messages with red styling
- Use `cn()` utility (from `clsx` + `tailwind-merge`) for conditional classes

## Docker Deployment

The app includes `Dockerfile` and `docker-compose.yml` for containerized deployment. Native dependencies (node-pty, better-sqlite3, bcrypt) require build tools in the container.

## Cloned Apps Location

Coolify apps are cloned to `~/coolify-apps/{app-name}` (or `{app-name}-{branch}` for non-main branches). The clone logic in `server/routes/coolify.js` uses git worktrees if the repo already exists locally.
