# Frontend Memory

## React Component Architecture

### Core Components and Their Responsibilities

#### App.jsx
- Root component with routing
- Session protection state management
- Project and session data fetching
- WebSocket message distribution

#### ChatInterface.jsx
- Main chat UI component
- Message streaming handling
- Session lifecycle management
- File autocomplete (@mentions)
- Tool results rendering

#### FileTree.jsx
- Recursive file/folder display
- Lazy loading of subdirectories
- File selection and opening
- Path breadcrumb navigation

#### Shell.jsx
- Terminal emulator integration
- WebSocket-based PTY communication
- xterm.js with WebGL acceleration
- URL detection for browser opening

#### Sidebar.jsx
- Project and session navigation
- Search and filtering
- Responsive collapse on mobile

### Custom Hooks

#### useWebSocket (utils/websocket.js)
- WebSocket connection management
- Auto-reconnection logic
- Message queuing
- Connection state tracking

#### useVersionCheck (hooks/useVersionCheck.js)
- GitHub release checking
- Version comparison
- Update notifications

#### useAudioRecorder (hooks/useAudioRecorder.js)
- Voice recording with MediaRecorder
- Transcription via backend API

### State Management Patterns

#### Session Protection System
```javascript
// Mark session active when sending message
markSessionAsActive(sessionId)

// Mark inactive when conversation ends
markSessionAsInactive(sessionId)

// Replace temporary with real session ID
replaceTemporarySession(realSessionId)
```

#### Local Storage Keys
- `theme` - Dark/light mode preference
- `autoExpandTools` - Tool expansion setting
- `showRawParameters` - Raw params display
- `chatDraft_${projectName}` - Message drafts

### Component Communication

#### Props Flow
```
App.jsx
  → selectedProject, sessions
    → ChatInterface
      → messages, sessionId
        → MessageComponent
          → Tool results, content
```

#### Context Usage
- `ThemeContext` - Global theme state
- Direct prop passing for other state

### UI/UX Patterns

#### Mobile Responsiveness
- Breakpoint: 768px
- Sidebar overlay on mobile
- Bottom navigation bar
- Touch-optimized interactions

#### Keyboard Shortcuts
- `Ctrl/Cmd + S` - Save file in editor
- `Esc` - Close modals
- `Enter` - Send message (without Shift)
- `↑↓` - Navigate file autocomplete

### Common Tasks

#### Adding New Component
1. Create in `src/components/`
2. Use functional component with hooks
3. Import required UI components
4. Handle loading and error states
5. Make responsive for mobile

#### Modifying Chat Behavior
- Edit `handleSendMessage` in ChatInterface
- Update WebSocket message handlers
- Preserve session protection logic
- Test with active conversations

#### Styling Guidelines
- Use Tailwind utilities primarily
- CSS variables for theme colors
- Consistent spacing (4, 8, 12, 16...)
- Dark mode via `dark:` prefix

### Performance Optimization

#### Message Rendering
- Limit to last 100 messages
- Memoize MessageComponent
- Virtual scrolling preparation

#### File Operations
- Debounce file search (150ms)
- Lazy load file contents
- Cache opened files locally

### Debugging Tips
- Check WebSocket connection in Network tab
- Monitor console for Claude responses
- Verify session IDs match
- Check localStorage for persisted data