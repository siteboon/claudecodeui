<div align="center">
  <img src="public/logo.svg" alt="Claude Code UI" width="64" height="64">
  <h1>Claude Code UI</h1>
</div>

A desktop and mobile UI for [Claude Code](https://docs.anthropic.com/en/docs/claude-code), and [Cursor CLI](https://docs.cursor.com/en/cli/overview). You can use it locally or remotely to view your active projects and sessions in Claude Code or Cursor and make changes to them from everywhere (mobile or desktop). This gives you a proper interface that works everywhere. Supports models including **Claude Sonnet 4**, **Opus 4.1**, and **GPT-5**

## Screenshots

<div align="center">

<table>
<tr>
<td align="center">
<h3>Desktop View</h3>
<img src="public/screenshots/desktop-main.png" alt="Desktop Interface" width="400">
<br>
<em>Main interface showing project overview and chat</em>
</td>
<td align="center">
<h3>Mobile Experience</h3>
<img src="public/screenshots/mobile-chat.png" alt="Mobile Interface" width="250">
<br>
<em>Responsive mobile design with touch navigation</em>
</td>
</tr>
<tr>
<td align="center" colspan="2">
<h3>CLI Selection</h3>
<img src="public/screenshots/cli-selection.png" alt="CLI Selection" width="400">
<br>
<em>Select between Claude Code and Cursor CLI</em>
</td>
</tr>
</table>

</div>

## Features

- **Responsive Design** - Works seamlessly across desktop, tablet, and mobile so you can also use Claude Code from mobile
- **Interactive Chat Interface** - Built-in chat interface for seamless communication with Claude Code or Cursor
- **Integrated Shell Terminal** - Direct access to Claude Code or Cursor CLI through built-in shell functionality
- **File Explorer** - Interactive file tree with syntax highlighting and live editing
- **Git Explorer** - View, stage and commit your changes. You can also switch branches
- **Session Management** - Resume conversations, manage multiple sessions, and track history
- **TaskMaster AI Integration** _(Optional)_ - Advanced project management with AI-powered task planning, PRD parsing, and workflow automation
- **Model Compatibility** - Works with Claude Sonnet 4, Opus 4.1, and GPT-5

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) v20 or higher
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and configured, and/or
- [Cursor CLI](https://docs.cursor.com/en/cli/overview) installed and configured

### Installation

1. **Clone the repository:**

```bash
git clone https://github.com/siteboon/claudecodeui.git
cd claudecodeui
```

2. **Install dependencies:**

```bash
npm install
```

3. **Configure environment:**

```bash
cp .env.example .env
# Edit .env with your preferred settings
```

4. **Start the application:**

```bash
# Development mode (with hot reload)
npm run dev

```

The application will start at the port you specified in your .env

5. **Open your browser:**
   - Development: `http://localhost:3001`

## Building Distribution Packages

Claude Code UI can be built as a desktop application for all major platforms using Electron.

### Prerequisites for Building

- Node.js 20.x or higher
- **Wine** (Linux only, for Windows cross-compilation):

  ```bash
  # Fedora/RHEL
  sudo dnf install wine

  # Ubuntu/Debian
  sudo apt install wine

  # Arch Linux
  sudo pacman -S wine
  ```

### Build Commands

#### Using Makefile (Recommended)

```bash
# See all available build targets
make help

# Build frontend only
make build

# Development
make dev                    # Start development servers
make electron-dev# Start Electron in development mode

# Distribution builds
make dist                   # Build for current platform
make dist-linux-all         # Build all Linux packages (AppImage, .deb, Flatpak)
make dist-linux-deb         # Build .deb packages only
make dist-linux-appimage    # Build AppImage packages only
make dist-linux-flatpak     # Build Flatpak package only
make dist-win              # Build Windows packages (requires Wine)
make dist-mac              # Build macOS packages (macOS only)
make dist-all              # Build all platforms
make release               # Clean and build all packages for release

# Utilities
make clean                 # Clean build artifacts
make setup                 # Setup development environment
```

#### Using npm Scripts

```bash
# Build frontend (required before packaging)
npm run build

# Package Electron app
npm run electron           # Run packaged app
npm run electron-dev       # Development mode

# Create distribution packages
npm run dist               # Current platform
npm run dist-linux         # Linux (AppImage + .deb)
npm run dist-win           # Windows (NSIS + portable)
npm run dist-mac           # macOS (DMG + ZIP)
npm run dist-all           # All platforms
```

### Distribution Files

After building, distribution packages will be available in the `release/` directory:

#### Linux

- **AppImage**: `Claude Code UI-[version].AppImage` (portable)
- **Debian**: `claude-code-ui_[version]_amd64.deb` (system package)
- **Flatpak**: `claude-code-ui-[version].flatpak` (sandboxed)

#### Windows

- **Installer**: `Claude Code UI Setup [version].exe` (NSIS installer)
- **Portable**: `Claude Code UI [version].exe` (no installation required)

#### macOS

- **DMG**: `Claude Code UI-[version].dmg` (drag-and-drop installer)
- **ZIP**: `Claude Code UI-[version]-mac.zip` (archive)

### Build Tips

- Always run `npm run build` or `make build` before creating distribution packages
- Use `make release` for a complete clean build of all packages
- Cross-platform builds work from Linux (Windows via Wine, macOS requires macOS)
- Distribution packages are optimized and include all dependencies

## Security & Tools Configuration

**🔒 Important Notice**: All Claude Code tools are **disabled by default**. This prevents potentially harmful operations from running automatically.

### Enabling Tools

To use Claude Code's full functionality, you'll need to manually enable tools:

1. **Open Tools Settings** - Click the gear icon in the sidebar
2. **Enable Selectively** - Turn on only the tools you need
3. **Apply Settings** - Your preferences are saved locally

<div align="center">

![Tools Settings Modal](public/screenshots/tools-modal.png)
_Tools Settings interface - enable only what you need_

</div>

**Recommended approach**: Start with basic tools enabled and add more as needed. You can always adjust these settings later.

## TaskMaster AI Integration _(Optional)_

Claude Code UI supports **[TaskMaster AI](https://github.com/eyaltoledano/claude-task-master)** (aka claude-task-master) integration for advanced project management and AI-powered task planning.

It provides

- AI-powered task generation from PRDs (Product Requirements Documents)
- Smart task breakdown and dependency management
- Visual task boards and progress tracking

**Setup & Documentation**: Visit the [TaskMaster AI GitHub repository](https://github.com/eyaltoledano/claude-task-master) for installation instructions, configuration guides, and usage examples.
After installing it you should be able to enable it from the Settings

## Usage Guide

### Core Features

#### Project Management

The UI automatically discovers Claude Code projects from `~/.claude/projects/` and provides:

- **Visual Project Browser** - All available projects with metadata and session counts
- **Project Actions** - Rename, delete, and organize projects
- **Smart Navigation** - Quick access to recent projects and sessions
- **MCP support** - Add your own MCP servers through the UI

#### Chat Interface

- **Use responsive chat or Claude Code/Cursor CLI** - You can either use the adapted chat interface or use the shell button to connect to your selected CLI.
- **Real-time Communication** - Stream responses from Claude with WebSocket connection
- **Session Management** - Resume previous conversations or start fresh sessions
- **Message History** - Complete conversation history with timestamps and metadata
- **Multi-format Support** - Text, code blocks, and file references

#### File Explorer & Editor

- **Interactive File Tree** - Browse project structure with expand/collapse navigation
- **Live File Editing** - Read, modify, and save files directly in the interface
- **Syntax Highlighting** - Support for multiple programming languages
- **File Operations** - Create, rename, delete files and directories

#### Git Explorer

#### TaskMaster AI Integration _(Optional)_

- **Visual Task Board** - Kanban-style interface for managing development tasks
- **PRD Parser** - Create Product Requirements Documents and parse them into structured tasks
- **Progress Tracking** - Real-time status updates and completion tracking

#### Session Management

- **Session Persistence** - All conversations automatically saved
- **Session Organization** - Group sessions by project and timestamp
- **Session Actions** - Rename, delete, and export conversation history
- **Cross-device Sync** - Access sessions from any device

### Mobile App

- **Responsive Design** - Optimized for all screen sizes
- **Touch-friendly Interface** - Swipe gestures and touch navigation
- **Mobile Navigation** - Bottom tab bar for easy thumb navigation
- **Adaptive Layout** - Collapsible sidebar and smart content prioritization
- **Add shortcut to Home Screen** - Add a shortcut to your home screen and the app will behave like a PWA

## Architecture

### System Overview

```

┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│ Frontend │ │ Backend │ │ Claude CLI │
│ (React/Vite) │◄──►│ (Express/WS) │◄──►│ Integration │
└─────────────────┘ └─────────────────┘ └─────────────────┘

```

### Backend (Node.js + Express)

- **Express Server** - RESTful API with static file serving
- **WebSocket Server** - Communication for chats and project refresh
- **CLI Integration (Claude Code / Cursor)** - Process spawning and management
- **Session Management** - JSONL parsing and conversation persistence
- **File System API** - Exposing file browser for projects

### Frontend (React + Vite)

- **React 18** - Modern component architecture with hooks
- **CodeMirror** - Advanced code editor with syntax highlighting

### Contributing

We welcome contributions! Please follow these guidelines:

#### Getting Started

1. **Fork** the repository
2. **Clone** your fork: `git clone <your-fork-url>`
3. **Install** dependencies: `npm install`
4. **Create** a feature branch: `git checkout -b feature/amazing-feature`

#### Development Process

1. **Make your changes** following the existing code style
2. **Test thoroughly** - ensure all features work correctly
3. **Run quality checks**: `npm run lint && npm run format`
4. **Commit** with descriptive messages following [Conventional Commits](https://conventionalcommits.org/)
5. **Push** to your branch: `git push origin feature/amazing-feature`
6. **Submit** a Pull Request with:
   - Clear description of changes
   - Screenshots for UI changes
   - Test results if applicable

#### What to Contribute

- **Bug fixes** - Help us improve stability
- **New features** - Enhance functionality (discuss in issues first)
- **Documentation** - Improve guides and API docs
- **UI/UX improvements** - Better user experience
- **Performance optimizations** - Make it faster

## Troubleshooting

### Common Issues & Solutions

#### "No Claude projects found"

**Problem**: The UI shows no projects or empty project list
**Solutions**:

- Ensure [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) is properly installed
- Run `claude` command in at least one project directory to initialize
- Verify `~/.claude/projects/` directory exists and has proper permissions
  d

#### File Explorer Issues

**Problem**: Files not loading, permission errors, empty directories
**Solutions**:

- Check project directory permissions (`ls -la` in terminal)
- Verify the project path exists and is accessible
- Review server console logs for detailed error messages
- Ensure you're not trying to access system directories outside project scope

## License

GNU General Public License v3.0 - see [LICENSE](LICENSE) file for details.

This project is open source and free to use, modify, and distribute under the GPL v3 license.

## Acknowledgments

### Built With

- **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)** - Anthropic's official CLI
- **[React](https://react.dev/)** - User interface library
- **[Vite](https://vitejs.dev/)** - Fast build tool and dev server
- **[Tailwind CSS](https://tailwindcss.com/)** - Utility-first CSS framework
- **[CodeMirror](https://codemirror.net/)** - Advanced code editor
- **[TaskMaster AI](https://github.com/eyaltoledano/claude-task-master)** _(Optional)_ - AI-powered project management and task planning

## Support & Community

### Stay Updated

- **Star** this repository to show support
- **Watch** for updates and new releases
- **Follow** the project for announcements

### Sponsors

- [Siteboon - AI powered website builder](https://siteboon.ai)

---

<div align="center">
  <strong>Made with care for the Claude Code community.</strong>
</div>
```
