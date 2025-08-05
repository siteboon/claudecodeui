# CLAUDE.md - Claude Code UI Project Guide

## 🚀 Quick Start Commands

### Development

**Local Development:**
```bash
# Start development server (frontend + backend)
npm run dev

# Start backend only
npm run server

# Start frontend only  
npm run client

# Build for production
npm run build
```

**Docker Development:**
```bash
# Start with Docker Compose (recommended)
docker compose -f docker-compose.dev.yml up

# Build and start in background
docker compose -f docker-compose.dev.yml up -d

# View logs
docker compose -f docker-compose.dev.yml logs -f

# Stop services
docker compose -f docker-compose.dev.yml down
```

### Testing & Quality
```bash
# Run tests (if available)
npm test

# Check for linting issues
npm run lint

# Type checking (if TypeScript)
npm run typecheck
```

### Port Configuration
- **Backend:** http://0.0.0.0:2008
- **Frontend:** http://localhost:2009
- **WebSocket:** ws://localhost:2008/ws

## 🐳 Docker Setup

This project includes complete Docker support for both development and production environments.

### Quick Docker Start
```bash
# Copy environment template
cp .env.docker .env

# Edit .env and add your Anthropic API key
# ANTHROPIC_API_KEY=sk-ant-your-api-key-here

# Start development environment
docker compose -f docker-compose.dev.yml up
```

### Environment Variables
Key environment variables for Docker deployment:

| Variable | Description | Example |
|----------|-------------|---------|
| `ANTHROPIC_API_KEY` | Your Claude API key | `sk-ant-xxxxx` |
| `DEFAULT_ADMIN_USERNAME` | Initial admin user | `admin` |
| `DEFAULT_ADMIN_PASSWORD` | Initial admin password | `secure-password` |
| `HOST_WORKSPACE_PATH` | Projects directory to mount | `${HOME}/Desktop` |
| `CLAUDE_EXECUTABLE_PATH` | Custom Claude CLI path | `/usr/local/bin/claude` |

See `DOCKER.md` for complete documentation and advanced configuration.

## 🏗️ High-Level Architecture

### Technology Stack
- **Frontend:** React 18 + Vite
- **Backend:** Express.js with WebSocket server
- **Database:** SQLite (better-sqlite3)
- **Authentication:** JWT + bcrypt
- **Real-time:** WebSockets for live chat

### System Design
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   React Client  │◄──►│  Express Server │◄──►│   Claude CLI    │
│                 │    │                 │    │                 │
│  - Chat UI      │    │  - Auth Routes  │    │  - Code Actions │
│  - Project Mgmt │    │  - WebSockets   │    │  - File Ops     │
│  - File Browser │    │  - Git API      │    │  - Tool Calling │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 ▼
                     ┌─────────────────┐
                     │  SQLite DB      │
                     │  - Users        │
                     │  - Sessions     │
                     │  - Projects     │
                     └─────────────────┘
```

### Key Components

#### Frontend (`/src`)
- **App.jsx** - Main application with session protection
- **ChatInterface.jsx** - Real-time chat with Claude
- **components/** - Reusable UI components
- **utils/api.js** - API client utilities

#### Backend (`/server`)
- **index.js** - Express server with WebSocket setup
- **routes/** - API endpoints (auth, git, files)
- **middleware/** - Authentication & validation
- **database/** - SQLite schema & operations

#### Authentication System
- **Single-user system** - Only one account allowed
- **JWT tokens** - Stateless authentication
- **Setup mode** - Automatic when no users exist
- **Session protection** - Prevents interruptions during active chats

## 🔧 Configuration & Setup

### Environment Variables
```bash
# Server configuration
PORT=2008
VITE_PORT=2009

# Database
DB_PATH=server/database/auth.db

# Optional: Claude API configuration
ANTHROPIC_API_KEY=your_key_here
```

### Claude Executable Configuration
The Claude CLI executable path can be configured through the Tools Settings:
1. Click **Tools Settings** in the sidebar
2. Find **Claude Executable Path** section
3. Enter the full path to your Claude CLI executable
4. Leave empty to use the default `claude` command from PATH
5. Click **Save Settings**

This is useful when:
- Claude is installed in a non-standard location
- Using multiple versions of Claude CLI
- Running in containerized environments
- Windows users with specific installation paths

### Initial Setup
1. **Clone and install dependencies:**
   ```bash
   npm install
   ```

2. **First run (setup mode):**
   ```bash
   npm run dev
   # Navigate to http://localhost:2009
   # Create your admin account
   ```

3. **Database reset (if needed):**
   ```bash
   rm server/database/auth.db
   npm run dev  # Triggers setup mode
   ```

## 🎯 Core Features

### Project Management
- **Multi-project support** - Switch between different codebases
- **Git integration** - Status, branches, and file tracking
- **Session isolation** - Each project maintains separate chat history
- **File browser** - Navigate and edit project files

### Chat Interface
- **Real-time messaging** - Instant responses via WebSockets  
- **Tool integration** - Claude can execute code operations
- **Session protection** - Prevents UI updates during active conversations
- **Message history** - Persistent chat logs per project
- **Status indicators** - Shows Claude's working state

### Security Features
- **Tool permissions** - Disabled by default for security
- **Project sandboxing** - Isolated file system access
- **Authentication required** - No anonymous access
- **Session validation** - JWT token verification

### Claude Executable Path Configuration
- **Custom executable path** - Configure custom path to Claude CLI
- **Default behavior** - Uses 'claude' command from PATH if not specified
- **Cross-platform support** - Works with Unix and Windows paths
- **Settings persistence** - Saved in browser localStorage
- **Examples**:
  - Unix/Linux/macOS: `/usr/local/bin/claude`
  - Windows: `C:\Program Files\Claude\claude.exe`
  - Custom installation: `/home/user/.npm-global/bin/claude`

## 🐛 Troubleshooting

### Common Issues

#### Port Conflicts
```bash
# Kill existing processes
pkill -f "node server/index.js"
pkill -f "npm run dev"

# Start fresh
npm run dev
```

#### Database Issues
```bash
# Reset database (triggers setup mode)
rm server/database/auth.db
npm run dev
```

#### Git Path Errors
- **Symptom:** Console logs showing "Project path not found"
- **Cause:** Projects reference non-existent directories
- **Fix:** Update project paths or remove orphaned projects

#### React Errors in ChatInterface
- **Symptom:** JavaScript errors when loading chat sessions
- **Cause:** Missing project directories or invalid status messages
- **Fix:** Implement better error boundaries and path validation

### Performance Optimization
```bash
# Clear node modules and reinstall
rm -rf node_modules package-lock.json
npm install

# Rebuild frontend
npm run build
```

## 📁 Project Structure

```
claudecodeui/
├── src/                    # React frontend
│   ├── components/         # Reusable UI components
│   │   ├── ChatInterface.jsx
│   │   ├── ClaudeStatus.jsx
│   │   └── TodoList.jsx
│   ├── utils/             # Frontend utilities
│   └── App.jsx            # Main application
├── server/                # Express backend
│   ├── routes/            # API endpoints
│   │   ├── auth.js        # Authentication
│   │   ├── git.js         # Git operations
│   │   └── files.js       # File management
│   ├── middleware/        # Auth & validation
│   ├── database/          # SQLite setup
│   └── index.js           # Server entry point
├── public/                # Static assets
├── package.json           # Dependencies & scripts
└── vite.config.js         # Frontend build config
```

## 🔄 Development Workflow

### Adding New Features
1. **Backend API:** Add routes in `/server/routes/`
2. **Frontend UI:** Create components in `/src/components/`
3. **WebSocket events:** Update both client and server handlers
4. **Database changes:** Modify schema in `/server/database/`

### Git Integration Points
- **Project loading:** `server/routes/git.js:62`
- **Status polling:** Continuous Git status checks
- **Branch management:** `server/routes/git.js:198`
- **Error handling:** `validateGitRepository()` function

### Session Protection System
- **Activation:** When user sends chat message
- **WebSocket events:** `session-created`, `claude-complete`, `session-aborted`  
- **Purpose:** Prevents sidebar updates during active conversations
- **Implementation:** `App.jsx` + `ChatInterface.jsx` coordination

## 🚨 Known Issues & Fixes

### Issue: Continuous Git Errors
**Problem:** Logs show repeated "Project path not found" errors
**Solution:**
```javascript
// Add to git.js validation
const validateProjectPath = (path) => {
  if (!fs.existsSync(path)) {
    console.warn(`Project path does not exist: ${path}`);
    return false;
  }
  return true;
};
```

### Issue: React Error in ChatInterface Line 1515
**Problem:** Error when loading existing chat sessions
**Location:** `src/components/ChatInterface.jsx:1515`
**Solution:** Add error boundary around claude-status message handling

### Issue: WebSocket Connection Drops
**Problem:** Chat becomes unresponsive
**Solution:** Implement automatic reconnection logic

## 📚 Integration with Claude Code CLI

This UI acts as a web interface for the Claude Code CLI:

### Tool Integration
- **File operations** - Read, write, edit files
- **Git commands** - Status, diff, commit, push
- **Terminal access** - Execute shell commands
- **Project navigation** - Browse directory structure

### API Endpoints
- `POST /api/chat/send` - Send message to Claude
- `GET /api/projects` - List available projects  
- `GET /api/git/status` - Get Git repository status
- `POST /api/files/read` - Read file contents
- `POST /api/files/write` - Write file contents

### WebSocket Events
- `message` - Chat messages
- `claude-status` - Working status updates
- `session-created` - New chat session
- `session-complete` - Chat finished
- `session-aborted` - Chat interrupted

## 🔐 Security Considerations

### Authentication
- **Single-user system** - Only one account supported
- **JWT expiration** - Tokens have limited lifetime  
- **Password hashing** - bcrypt with salt rounds 12
- **Setup protection** - Registration only when no users exist

### File System Access
- **Project sandboxing** - Limited to configured directories
- **Path validation** - Prevent directory traversal attacks
- **Tool permissions** - Disabled by default
- **Git operations** - Validated repository paths

### Network Security
- **CORS configuration** - Restricted origins
- **WebSocket authentication** - JWT token required
- **Input validation** - Sanitized user inputs
- **Error messages** - No sensitive information leakage

---

## 📞 Support & Maintenance

### Health Checks
- **Database connection** - SQLite file integrity
- **WebSocket status** - Active connections count
- **Git operations** - Repository accessibility
- **File system** - Project directory permissions

### Monitoring
- **Server logs** - Console output for debugging
- **Error tracking** - Catch and log exceptions
- **Performance** - WebSocket message timing
- **Resource usage** - Memory and CPU monitoring

### Updates
- **Dependencies** - Regular npm audit and updates
- **Security patches** - Keep Express and React current
- **Claude CLI** - Ensure compatibility with latest version
- **Database migrations** - Handle schema changes

---

*Last Updated: 2024-12-28*  
*Version: 1.4.0*  
*Tested with: Claude Code CLI*