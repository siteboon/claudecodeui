# Codebase Structure

**Analysis Date:** 2026-01-24

## Directory Layout

```
claudecodeui/
├── server/                  # Express backend server
│   ├── index.js             # Main server entry point (1775 lines)
│   ├── cli.js               # CLI argument parsing and startup
│   ├── projects.js          # Project discovery system (1895 lines)
│   ├── claude-sdk.js        # Claude provider integration
│   ├── cursor-cli.js        # Cursor provider integration
│   ├── openai-codex.js      # Codex provider integration
│   ├── routes/              # Express route handlers
│   │   ├── agent.js         # External agent API endpoints
│   │   ├── auth.js          # Authentication (login, register, JWT)
│   │   ├── commands.js      # AI model command routing
│   │   ├── cursor.js        # Cursor-specific operations
│   │   ├── git.js           # Git operations (status, commit, push)
│   │   ├── mcp.js           # MCP server detection and config
│   │   ├── mcp-utils.js     # MCP utility functions
│   │   ├── projects.js      # Project CRUD operations
│   │   ├── settings.js      # Settings management
│   │   ├── taskmaster.js    # TaskMaster initialization and task parsing
│   │   ├── user.js          # User profile (git config, onboarding)
│   │   ├── cli-auth.js      # CLI-specific auth
│   │   └── codex.js         # Codex sessions and MCP config
│   ├── database/            # SQLite persistence
│   │   ├── db.js            # Database initialization and migrations
│   │   ├── auth.db          # SQLite database file (users, API keys, tokens)
│   │   └── init.sql         # Database schema initialization
│   ├── middleware/          # Express middleware
│   │   └── auth.js          # Token validation, API key verification
│   └── utils/               # Server utilities
│       ├── commandParser.js # Parse CLI-style commands
│       ├── mcp-detector.js  # Detect MCP configurations
│       ├── gitConfig.js     # Git config helpers
│       └── taskmaster-websocket.js # WebSocket TaskMaster communication
│
├── src/                     # React frontend application
│   ├── main.jsx             # React app entry point
│   ├── App.jsx              # Main app component (1007 lines)
│   ├── index.css            # Tailwind + global styles
│   ├── components/          # React components (53 files)
│   │   ├── ChatInterface.jsx # Main chat UI with message rendering
│   │   ├── Sidebar.jsx      # Project/session list navigation
│   │   ├── MainContent.jsx  # Layout orchestration
│   │   ├── Settings.jsx     # User settings interface
│   │   ├── FileTree.jsx     # Project file browser
│   │   ├── CodeEditor.jsx   # Code viewing/editing
│   │   ├── TaskCard.jsx     # TaskMaster task display
│   │   ├── Shell.jsx        # Terminal emulation (xterm)
│   │   ├── GitPanel.jsx     # Git operations UI
│   │   ├── LoginForm.jsx    # Authentication UI
│   │   ├── DarkModeToggle.jsx # Theme switching
│   │   ├── ui/              # Reusable UI components
│   │   └── settings/        # Settings sub-components
│   ├── contexts/            # React Context providers (5 files)
│   │   ├── AuthContext.jsx  # User authentication state
│   │   ├── ThemeContext.jsx # Dark/light mode
│   │   ├── WebSocketContext.jsx # WebSocket connection
│   │   ├── TaskMasterContext.jsx # TaskMaster data
│   │   └── TasksSettingsContext.jsx # Task UI preferences
│   ├── hooks/               # Custom React hooks (5 files)
│   │   ├── useAudioRecorder.js # Audio input for voice chat
│   │   ├── useVersionCheck.js # Check for app updates
│   │   └── useLocalStorage.js # Persist state to localStorage
│   ├── utils/               # Frontend utilities
│   │   ├── api.js           # REST API endpoints object
│   │   ├── websocket.js     # WebSocket connection hook
│   │   └── whisper.js       # Whisper API integration
│   ├── lib/                 # Helper libraries
│   │   └── utils.js         # General utilities (JSON parsing, etc.)
│   └── i18n/                # Internationalization
│       ├── config.js        # i18next setup
│       └── languages.js     # Language definitions
│
├── shared/                  # Shared code between frontend/backend
│   └── modelConstants.js    # AI model definitions (single source of truth)
│
├── public/                  # Static assets
│   ├── index.html           # Production HTML template
│   ├── manifest.json        # PWA manifest
│   ├── icons/               # App icons
│   └── ...                  # Logo files, favicons
│
├── vite.config.js           # Vite build configuration
├── tailwind.config.js       # Tailwind CSS configuration
├── postcss.config.js        # PostCSS configuration
├── package.json             # Dependencies and scripts
├── package-lock.json        # Dependency lockfile
├── .env.example             # Environment variable template
├── .nvmrc                   # Node version
├── index.html               # Development HTML template
└── README.md                # Project documentation
```

## Directory Purposes

**`server/`:**
- Purpose: Complete Express backend server handling project discovery, session management, provider integration
- Contains: Route handlers, provider SDKs, database, utilities
- Key files: `index.js` (server initialization), `projects.js` (project discovery), route handlers

**`server/routes/`:**
- Purpose: Modular Express route handlers for each feature area
- Contains: 13 route files with specific responsibilities (auth, projects, git, MCP, etc.)
- Pattern: Each file exports an Express router with related endpoints

**`server/database/`:**
- Purpose: SQLite persistence layer for users, API keys, GitHub tokens
- Contains: Database driver setup, schema initialization, migrations
- Key files: `db.js` (initialization and exports), `auth.db` (SQLite database)

**`server/utils/`:**
- Purpose: Shared utilities used by multiple route handlers and modules
- Contains: Command parsing, MCP detection, WebSocket helpers, git configuration
- Not: Business logic (keep this thin and reusable)

**`src/`:**
- Purpose: React frontend application code
- Contains: Components, contexts, hooks, utilities, styles
- Entry point: `main.jsx` renders App component

**`src/components/`:**
- Purpose: React UI components (53 components total)
- Organization: Feature-based (ChatInterface, FileTree, Settings, etc.)
- Sub-directories: `ui/` (reusable UI primitives), `settings/` (settings-specific components)

**`src/contexts/`:**
- Purpose: React Context providers for global state
- Usage: Authentication, theme, WebSocket connection, TaskMaster data, task settings
- Pattern: Each file exports a provider component and a hook to use it

**`src/hooks/`:**
- Purpose: Reusable React hooks for specific functionality
- Examples: Audio recording, version checking, localStorage persistence

**`src/utils/`:**
- Purpose: Frontend utilities and API client
- Key file: `api.js` defines all REST endpoints and their signatures
- WebSocket: `websocket.js` implements WebSocket connection with auto-reconnect

**`src/lib/`:**
- Purpose: General-purpose helper functions
- Example: `utils.js` has safe JSON parsing, HTML entity decoding, etc.

**`src/i18n/`:**
- Purpose: Internationalization configuration and language definitions
- Used by: All components via `useTranslation()` hook from react-i18next

**`shared/`:**
- Purpose: Code shared between frontend and backend
- Contains: `modelConstants.js` - unified model definitions (Claude, Cursor, Codex)
- Pattern: Imported by both `src/App.jsx` and `server/routes/agent.js`

**`public/`:**
- Purpose: Static assets served by Express (icons, manifest, etc.)
- Production: Copied to dist/ by Vite build
- PWA: `manifest.json` enables installable app experience

## Key File Locations

**Entry Points:**
- `server/index.js`: Express server initialization, WebSocket setup, database connection
- `server/cli.js`: CLI argument parsing and server launch
- `src/main.jsx`: React app initialization and mounting
- `src/App.jsx`: Main app component with routing and session management

**Configuration:**
- `package.json`: Dependencies, scripts, project metadata
- `.env.example`: Environment variable documentation
- `vite.config.js`: Frontend build configuration (chunking, proxying)
- `tailwind.config.js`: Tailwind theme customization
- `server/database/init.sql`: Database schema

**Core Logic:**
- `server/projects.js`: Project discovery, enumeration, session extraction
- `server/index.js`: Main API endpoints, WebSocket server, file watcher
- `server/claude-sdk.js`: Claude provider integration (SDK queries)
- `server/cursor-cli.js`: Cursor provider integration (child process management)
- `server/openai-codex.js`: Codex provider integration

**Authentication:**
- `server/routes/auth.js`: Login, registration, JWT token generation
- `server/routes/agent.js`: External agent API key validation
- `server/middleware/auth.js`: Token validation middleware
- `server/database/db.js`: User/API key database management

**Frontend State Management:**
- `src/App.jsx`: Application-level state (projects, sessions, activeSessions)
- `src/contexts/AuthContext.jsx`: Authentication state
- `src/contexts/WebSocketContext.jsx`: WebSocket connection state
- `src/contexts/TaskMasterContext.jsx`: TaskMaster data

**UI Features:**
- `src/components/ChatInterface.jsx`: Chat display and message input
- `src/components/Sidebar.jsx`: Project/session navigation
- `src/components/FileTree.jsx`: Project file browser
- `src/components/Shell.jsx`: Terminal emulation UI
- `src/components/Settings.jsx`: User settings UI

**Utilities:**
- `src/utils/api.js`: REST API client - defines all endpoints
- `src/utils/websocket.js`: WebSocket connection with reconnection logic
- `shared/modelConstants.js`: Supported models for Claude/Cursor/Codex

## Naming Conventions

**Files:**
- React components: `PascalCase.jsx` (e.g., `ChatInterface.jsx`, `FileTree.jsx`)
- Utils/helpers: `camelCase.js` (e.g., `api.js`, `websocket.js`)
- Server routes: `kebab-descriptive.js` (e.g., `git.js`, `mcp.js`)
- Database: `auth.db` (SQLite), `db.js` (database module)

**Directories:**
- Feature directories: lowercase (e.g., `components/`, `contexts/`, `utils/`, `routes/`)
- Sub-component groups: lowercase (e.g., `settings/`, `ui/`)
- Server feature modules: at root of `server/` (e.g., `claude-sdk.js`, `projects.js`)

**React Components:**
- Named exports: Function component with matching name
- Hooks: `use*` prefix (e.g., `useWebSocket`, `useTheme`, `useAuth`)
- Context providers: Component name + "Provider" suffix
- Context hooks: `use` + Context name (e.g., `useWebSocketContext`)

**Functions:**
- API methods: verb + noun pattern (e.g., `getProjects`, `deleteSession`, `renameProject`)
- Callbacks: `handle*` or `on*` pattern (e.g., `handleSubmit`, `onSessionCreated`)
- Utilities: descriptive lowercase (e.g., `decodeHtmlEntities`, `normalizeInlineCodeFences`)

**Constants:**
- Model constants: `UPPERCASE` with `_UNDERSCORE` (e.g., `CLAUDE_MODELS`, `CURSOR_MODELS`)
- Environment variables: `UPPERCASE_WITH_UNDERSCORE` (e.g., `VITE_IS_PLATFORM`, `DATABASE_PATH`)

## Where to Add New Code

**New Feature:**
- Primary code: Create route in `server/routes/newfeature.js`, import in `server/index.js`
- Frontend: Create component in `src/components/NewFeature.jsx`
- Tests: Not currently in repo; would go in `__tests__` directories alongside components
- Example: Adding a new AI provider would require `server/newprovider.js` and routes in `server/routes/`

**New Component/Module:**
- UI components: `src/components/ComponentName.jsx`
- Context/state: `src/contexts/FeatureContext.jsx`
- Custom hooks: `src/hooks/useFeatureName.js`
- API utilities: Add method to `src/utils/api.js` object
- Backend logic: New file in `server/` or new route in `server/routes/`

**Utilities:**
- Frontend general utilities: `src/lib/utils.js` or `src/utils/utilName.js`
- Backend general utilities: `server/utils/utilName.js`
- Shared code: `shared/constantsOrHelpers.js`
- Model/provider constants: Update `shared/modelConstants.js`

**Database Changes:**
- Schema: Update `server/database/init.sql`
- Migrations: Add migration in `server/database/db.js` `runMigrations()` function
- Database layer: Implement in `db.js` or create new database module

**Styling:**
- Global styles: `src/index.css` (Tailwind directives)
- Component styles: Inline via Tailwind class names (no CSS modules currently)
- Theme: Customizations in `tailwind.config.js` and `src/contexts/ThemeContext.jsx`

**Configuration:**
- Environment: Update `.env.example` and document in README.md
- Build: Modify `vite.config.js` for frontend, `package.json` for scripts
- Routing: Add route in `server/index.js` and `src/App.jsx`

## Special Directories

**`node_modules/`:**
- Purpose: Installed dependencies (npm)
- Generated: Yes
- Committed: No (in .gitignore)
- Usage: Import packages in code normally, no manual changes

**`dist/`:**
- Purpose: Production build output from Vite
- Generated: Yes (by `npm run build`)
- Committed: No (in .gitignore)
- Served by: Express static middleware in production

**`.codex/`:**
- Purpose: Codex MCP server integration
- Generated: By Codex installation
- Committed: No (in .gitignore)

**`.serena/`:**
- Purpose: Serena semantic code operations cache
- Generated: Yes
- Committed: No

**`.planning/`:**
- Purpose: GSD planning documents and codebase analysis
- Generated: Yes (by GSD mapping commands)
- Committed: Yes (planning artifacts are versioned)
- Sub-directory: `.planning/codebase/` contains ARCHITECTURE.md, STRUCTURE.md, etc.

---

*Structure analysis: 2026-01-24*
