# Technology Stack

**Analysis Date:** 2026-01-24

## Languages

**Primary:**
- JavaScript (Node.js) - Backend server, CLI, and build tooling
- TypeScript - Type safety for React components (JSX/TSX support)
- HTML/CSS - Frontend markup and styling

**Secondary:**
- SQL - SQLite database queries via prepared statements

## Runtime

**Environment:**
- Node.js v20.19.3 (specified in `.nvmrc`)

**Package Manager:**
- npm
- Lockfile: `package-lock.json` (present)

## Frameworks

**Core:**
- React 18.2.0 - Frontend UI framework
- Express 4.18.2 - Backend REST API and WebSocket server
- Vite 7.0.4 - Frontend build tool and dev server

**UI/Styling:**
- Tailwind CSS 3.4.0 - Utility-first CSS framework
- PostCSS 8.4.32 - CSS processing with autoprefixer
- @tailwindcss/typography 0.5.16 - Typography plugin for Markdown rendering

**Code Editor:**
- @uiw/react-codemirror 4.23.13 - React wrapper for CodeMirror
- CodeMirror 6.x - Language syntax highlighting
  - @codemirror/lang-javascript 6.2.4
  - @codemirror/lang-python 6.2.1
  - @codemirror/lang-json 6.0.1
  - @codemirror/lang-markdown 6.3.3
  - @codemirror/lang-html 6.4.9
  - @codemirror/lang-css 6.3.1
  - @codemirror/merge 6.11.1 - Diff/merge view
  - @codemirror/theme-one-dark 6.1.2 - Dark theme
  - @replit/codemirror-minimap 0.5.2 - Code minimap

**Terminal:**
- xterm 5.5.0 - Terminal emulator for browser
  - @xterm/addon-fit 0.10.0 - Terminal auto-fit
  - @xterm/addon-clipboard 0.1.0 - Clipboard support
  - @xterm/addon-webgl 0.18.0 - WebGL rendering
  - @xterm/addon-web-links 0.11.0 - Link detection

**Routing:**
- react-router-dom 6.8.1 - Client-side routing

**Internationalization:**
- i18next 25.7.4 - Translation framework
- i18next-browser-languagedetector 8.2.0 - Auto language detection
- react-i18next 16.5.3 - React integration

**Markdown/Math:**
- react-markdown 10.1.0 - Markdown rendering
- remark-gfm 4.0.0 - GitHub Flavored Markdown plugin
- remark-math 6.0.0 - Math notation plugin
- rehype-katex 7.0.1 - KaTeX math rendering
- katex 0.16.25 - LaTeX math typesetting
- react-syntax-highlighter 15.6.1 - Code syntax highlighting in Markdown

**Utilities:**
- fuse.js 7.0.0 - Fuzzy search for file/project search
- react-dropzone 14.2.3 - File upload handling
- lucide-react 0.515.0 - Icon library
- clsx 2.1.1 - Classname utility
- tailwind-merge 3.3.1 - Tailwind class merging
- class-variance-authority 0.7.1 - Component variant system

## Key Dependencies

**Critical:**
- @anthropic-ai/claude-agent-sdk 0.1.29 - Direct SDK integration with Claude models
- @openai/codex-sdk 0.75.0 - OpenAI Codex integration for code generation
- @octokit/rest 22.0.0 - GitHub API client for repository operations

**Authentication & Security:**
- bcrypt 6.0.0 - Password hashing (12 salt rounds)
- jsonwebtoken 9.0.2 - JWT token generation and validation

**Database:**
- better-sqlite3 12.2.0 - Synchronous SQLite database with prepared statements
- sqlite3 5.1.7 - Additional SQLite support
- sqlite 5.1.1 - SQLite CLI wrapper

**Data Processing:**
- @iarna/toml 2.2.5 - TOML parser for .codex/config.toml
- gray-matter 4.0.3 - YAML frontmatter parsing (for task files)
- mime-types 3.0.1 - MIME type detection

**File Operations:**
- multer 2.0.1 - Express multipart form data handling
- chokidar 4.0.3 - File system watcher for project changes

**Process Management:**
- node-pty 1.1.0-beta34 - Pseudo-terminal for interactive shell sessions
- cross-spawn 7.0.3 - Cross-platform child process spawning

**Networking:**
- ws 8.14.2 - WebSocket server for real-time communication
- node-fetch 2.7.0 - Fetch API polyfill for Node.js
- cors 2.8.5 - CORS middleware for Express

**Development:**
- concurrently 8.2.2 - Run multiple npm scripts simultaneously
- @vitejs/plugin-react 4.6.0 - Vite React plugin with JSX/TSX
- @types/react 18.2.43 - TypeScript types for React
- @types/react-dom 18.2.17 - TypeScript types for ReactDOM
- autoprefixer 10.4.16 - CSS vendor prefixing
- sharp 0.34.2 - Image processing
- release-it 19.0.5 - Automated release management
- auto-changelog 2.5.0 - Changelog generation
- node-gyp 10.0.0 - Build tool for native modules

## Configuration

**Environment Variables:**
- `PORT` - Backend server port (default: 3001)
- `VITE_PORT` - Frontend dev server port (default: 5173)
- `DATABASE_PATH` - SQLite database file location (default: `server/database/auth.db`)
- `CONTEXT_WINDOW` / `VITE_CONTEXT_WINDOW` - Claude context window size (default: 160000)
- `CLAUDE_CLI_PATH` - Path to Claude CLI (default: `claude`)
- `CLAUDE_TOOL_APPROVAL_TIMEOUT_MS` - Tool approval timeout (default: 55000ms)
- `JWT_SECRET` - JWT signing secret (default: 'claude-ui-dev-secret-change-in-production')
- `API_KEY` - Optional API key for authentication
- `OPENAI_API_KEY` - OpenAI API key for Codex integration
- `VITE_IS_PLATFORM` - Platform mode flag for multi-user deployments
- `SKIP_PROJECTS_PATTERN` - Comma-separated project name patterns to exclude
- `SKIP_LARGE_PROJECTS_MB` - Skip projects larger than this size (in MB)
- `WORKSPACES_ROOT` - Root directory for workspaces (default: home directory)

**Build Configuration:**
- `vite.config.js` - Vite build configuration with React plugin, proxy config, code splitting
- `tailwind.config.js` - Tailwind CSS configuration with custom theme colors
- `postcss.config.js` - PostCSS configuration with Tailwind and autoprefixer
- `.eslintignore` / `.npmignore` - Build artifact exclusions

## Platform Requirements

**Development:**
- Node.js v20.19.3 or compatible
- npm lockfile support
- Better-sqlite3 requires C++ compiler for native module compilation (node-gyp)

**Production:**
- Node.js v20.19.3+
- SQLite 3.x (included with better-sqlite3)
- Disk space for SQLite database and project metadata caching
- Network access to Claude API (via Claude SDK or CLI) and OpenAI API (optional)
- For GPU rendering: WebGL support in browser (xterm with WebGL addon)

---

*Stack analysis: 2026-01-24*
