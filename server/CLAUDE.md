# Backend Memory

## Server Architecture

### Key Files and Their Purposes
- `index.js` - Express server setup, WebSocket handling, API routes
- `claude-cli.js` - Claude process spawning and management
- `projects.js` - Project discovery and session management
- `routes/git.js` - Git operations endpoints

### Important Functions

#### Process Management (claude-cli.js)
- `spawnClaude(command, options, ws)` - Spawns Claude CLI process
- `abortClaudeSession(sessionId)` - Terminates active session
- `activeClaudeProcesses` Map - Tracks running processes

#### Project Management (projects.js)
- `getProjects()` - Returns all projects from ~/.claude/projects/
- `extractProjectDirectory(projectName)` - Resolves actual project path
- `getSessions(projectName, limit, offset)` - Paginated session list
- `getSessionMessages(projectName, sessionId)` - Load session history

### WebSocket Message Types

#### Chat WebSocket (/ws)
Incoming:
- `claude-command` - Execute Claude command
- `abort-session` - Stop active session

Outgoing:
- `claude-response` - Streaming Claude output
- `session-created` - New session ID
- `claude-status` - Working status updates
- `claude-complete` - Session finished
- `projects_updated` - File system changes

#### Shell WebSocket (/shell)
- `init` - Initialize terminal
- `input` - User keyboard input
- `output` - Terminal output
- `resize` - Terminal dimensions
- `url_open` - Detected URL for opening

### API Endpoints Reference

#### Project Management
- `GET /api/projects` - List all projects
- `POST /api/projects/create` - Create new project
- `PUT /api/projects/:name/rename` - Rename project
- `DELETE /api/projects/:name` - Delete empty project

#### Session Management
- `GET /api/projects/:name/sessions` - List sessions
- `GET /api/projects/:name/sessions/:id/messages` - Get messages
- `DELETE /api/projects/:name/sessions/:id` - Delete session

#### File Operations
- `GET /api/projects/:name/files` - File tree
- `GET /api/projects/:name/file?filePath=...` - Read file
- `PUT /api/projects/:name/file` - Save file
- `GET /api/projects/:name/files/content?path=...` - Binary files

### Common Tasks

#### Adding New API Endpoint
1. Create handler function
2. Add route in index.js
3. Follow RESTful conventions
4. Validate inputs
5. Handle errors gracefully

#### Debugging Claude Process
- Check `activeClaudeProcesses` Map
- Monitor stdout/stderr streams
- Verify process spawn arguments
- Check WebSocket connection state

### Environment Variables
- `PORT` - Server port (default: 3008)
- `OPENAI_API_KEY` - For audio transcription