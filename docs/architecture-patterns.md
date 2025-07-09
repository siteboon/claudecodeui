# Architecture Patterns

## Core Architectural Principles

### Separation of Concerns
- Frontend (React/Vite) handles UI and user interactions
- Backend (Express/Node) manages Claude processes and file operations
- WebSocket layer handles real-time communication
- Each module has single, well-defined responsibility

### Communication Patterns

#### WebSocket Message Flow
```
Client → Server: { type: 'action', payload: data }
Server → Client: { type: 'response', data: result }
```

#### Session Protection Pattern
- Active sessions block project updates
- Temporary session IDs transition to real IDs
- Queue updates during active conversations
- Apply updates only when session inactive

### State Management Patterns

#### Frontend State Hierarchy
```
App.jsx (Global State)
  ├── Projects & Sessions
  ├── Active Session Management
  └── UI State (theme, modals)

Components (Local State)
  ├── Form inputs
  ├── UI toggles
  └── Temporary data
```

#### Backend State Management
- In-memory Maps for active processes
- File-based persistence for sessions
- No database - simplicity over scalability

### Security Patterns
- All tools disabled by default
- Explicit user consent for permissions
- Path validation on all file operations
- Process isolation per session

### Performance Patterns
- Debounce file system watchers (300ms)
- Limit rendered messages (100 max)
- Memoize expensive React components
- Cache project directory lookups

### Error Handling Patterns
- Graceful degradation on failures
- User-friendly error messages
- Detailed console logging for debugging
- WebSocket auto-reconnection

### File Organization Pattern
```
feature/
  ├── Component.jsx     # UI component
  ├── useFeature.js    # Custom hook
  ├── utils.js         # Helper functions
  └── Component.css    # Styles (if needed)
```