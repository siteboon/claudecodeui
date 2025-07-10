<div align="center">
  <img src="public/logo.svg" alt="Claude Code UI" width="64" height="64">
  <h1>Claude Code UI</h1>
</div>


A desktop and mobile UI for [Claude Code](https://docs.anthropic.com/en/docs/claude-code), Anthropic's official CLI for AI-assisted coding. You can use it locally or remotely to view your active projects and sessions in claude code and make changes to them the same way you would do it in claude code CLI. This gives you a proper interface that works everywhere. 

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
</table>



</div>

## Features

### Core Functionality
- **Responsive Design** - Works seamlessly across desktop, tablet, and mobile
- **Interactive Chat Interface** - Built-in chat interface for seamless communication with Claude Code
- **Integrated Shell Terminal** - Direct access to Claude Code CLI through built-in shell functionality
- **File Explorer** - Interactive file tree with syntax highlighting and live editing
- **Session Management** - Resume conversations, manage multiple sessions, and track history

### 🆕 Latest Enhancements

#### Advanced Conversation Management System
- **Smart Conversation Grouping** - Messages are automatically grouped into logical conversations based on related sessions
- **Full Conversation History** - Click any message in the sidebar to view complete conversation history across multiple sessions
- **Real-time Sidebar Updates** - New messages immediately appear in the sidebar with updated counts and timestamps
- **Instant New Conversations** - "New Conversation" button creates placeholder conversations that appear instantly in the sidebar
- **Persistent Placeholders** - New conversations persist across browser refreshes until messages are sent
- **Conversation Navigation** - Navigate between conversations and jump to specific sessions/messages
- **Message Count Accuracy** - Sidebar correctly displays message counts instead of session counts

#### Checkpoint System with Revert Functionality
- **Create Checkpoints** - Automatically capture project state at key conversation points
- **Revert to Checkpoints** - Click any checkpoint to restore files and truncate conversation history
- **Server-Side Persistence** - Messages are permanently removed from server storage, not just hidden
- **Smart Recovery** - Maintains checkpoint integrity across browser sessions and page refreshes

#### Enhanced Tools Configuration
- **Expanded Tool Library** - 30+ pre-configured bash commands for quick setup
- **Quick Add Buttons** - One-click addition of common development tools (git, npm, file operations)
- **Organized Categories** - Tools grouped by function: Git commands, package management, file operations, development tools
- **Granular Permissions** - Fine-grained control over which bash commands are allowed


## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) v16 or higher
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and configured

### Installation

1. **Clone the repository:**
```bash
git clone https://github.com/ItsAChillBear/claudecodeui.git
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

5. **Open your browser:**
   - Development: `http://localhost:3009` (Frontend) and `http://localhost:3008` (API Server)

## Security & Tools Configuration

**🔒 Important Notice**: All Claude Code tools are **disabled by default**. This prevents potentially harmful operations from running automatically.

### Enabling Tools

To use Claude Code's full functionality, you'll need to manually enable tools:

1. **Open Tools Settings** - Click the gear icon in the sidebar
2. **Quick Add Common Tools** - Use the new one-click buttons to add essential development tools:
   - **Git Commands**: `add`, `commit`, `push`, `pull`, `checkout`, `branch`, `merge`, `reset`, `stash`, `config`, `remote`
   - **Package Management**: `npm`, `yarn`, `pnpm`, `node`, `npx`
   - **File Operations**: `ls`, `cat`, `mkdir`, `cp`, `mv`, `rm`, `find`
   - **Development Tools**: `rg` (ripgrep), `code`, `curl`, `wget`
   - **Process Management**: `ps`, `kill`, `killall`
3. **Enable Selectively** - Turn on only the tools you need, or add custom patterns
4. **Apply Settings** - Your preferences are saved locally

<div align="center">

![Tools Settings Modal](public/screenshots/tools-modal.png)
*Tools Settings interface - enable only what you need*

</div>

**Recommended approach**: Start with basic tools enabled and add more as needed. You can always adjust these settings later.

## Recent Updates & Changelog

### Latest Release - Enhanced Conversation Management & Checkpoint System

#### 🎯 Major Features Added
- **Advanced Conversation Management**: Smart grouping, full history navigation, and instant conversation creation
- **Real-time Sidebar Updates**: Messages appear immediately in sidebar with accurate counts and timestamps
- **Complete Checkpoint System**: Full implementation of checkpoint creation, restoration, and conversation truncation
- **Server-Side Message Persistence**: Messages are permanently removed from JSONL files, not just hidden client-side
- **Expanded Tools Library**: 30+ pre-configured bash commands with categorized quick-add buttons
- **Enhanced Permission System**: Granular control over development tools and commands

#### 🔧 Technical Improvements
- **Intelligent Session Grouping**: Advanced algorithms for grouping sessions into logical conversations
- **Real-time Activity Tracking**: Immediate sidebar updates bypassing session protection for visual feedback
- **Placeholder Session System**: Persistent conversation placeholders with localStorage-based persistence
- **Conversation State Management**: Comprehensive state management for navigation and history viewing
- **Fuzzy Checkpoint Matching**: Robust checkpoint ID assignment that handles timestamp mismatches
- **WebSocket Message Truncation**: Real-time coordination between client and server for conversation management
- **Atomic File Operations**: Safe file restoration using temporary files and atomic renames
- **Cross-Session Persistence**: Checkpoint markers survive browser refreshes and session reloads

#### 🐛 Bug Fixes
- Fixed new conversations not appearing immediately in sidebar when created
- Resolved issue where conversation counts showed sessions instead of actual conversation counts
- Fixed placeholder sessions disappearing on browser refresh
- Improved message routing to ensure new messages appear in correct conversations
- Fixed checkpoint revert button not permanently removing messages after checkpoint
- Resolved issue where messages reappeared after page refresh following revert
- Improved checkpoint ID assignment for messages loaded from server sessions
- Enhanced error handling for checkpoint restoration failures

## Usage Guide

### Core Features

#### Project Management
The UI automatically discovers Claude Code projects from `~/.claude/projects/` and provides:
- **Visual Project Browser** - All available projects with metadata and session counts
- **Project Actions** - Rename, delete, and organize projects
- **Smart Navigation** - Quick access to recent projects and sessions

#### Chat Interface
- **Use responsive chat or Claude Code CLI** - You can either use the adapted chat interface or use the shell button to connect to Claude Code CLI. 
- **Real-time Communication** - Stream responses from Claude with WebSocket connection
- **Session Management** - Resume previous conversations or start fresh sessions
- **Message History** - Complete conversation history with timestamps and metadata
- **Multi-format Support** - Text, code blocks, and file references
- **🆕 Checkpoint System** - Automatically create checkpoints at key conversation points
- **🆕 Revert Functionality** - Click checkpoint buttons to restore project state and truncate conversation history

#### File Explorer & Editor
- **Interactive File Tree** - Browse project structure with expand/collapse navigation
- **Live File Editing** - Read, modify, and save files directly in the interface
- **Syntax Highlighting** - Support for multiple programming languages
- **File Operations** - Create, rename, delete files and directories

#### Session Management
- **Session Persistence** - All conversations automatically saved
- **Session Organization** - Group sessions by project and timestamp
- **Session Actions** - Rename, delete, and export conversation history
- **Cross-device Sync** - Access sessions from any device
- **🆕 Conversation Management** - Sessions are intelligently grouped into conversations
- **🆕 Instant Conversation Creation** - New conversations appear immediately in sidebar before sending messages
- **🆕 Full History Navigation** - Click any conversation to view complete message history across all sessions
- **🆕 Smart Conversation Counting** - Delete operations count conversations, not individual sessions

### Mobile Experience
- **Responsive Design** - Optimized for all screen sizes
- **Touch-friendly Interface** - Swipe gestures and touch navigation
- **Mobile Navigation** - Bottom tab bar for easy thumb navigation
- **Adaptive Layout** - Collapsible sidebar and smart content prioritization

## Architecture

### System Overview

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │    │   Backend       │    │  Claude CLI     │
│   (React/Vite)  │◄──►│ (Express/WS)    │◄──►│  Integration    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Backend (Node.js + Express)
- **Express Server** - RESTful API with static file serving
- **WebSocket Server** - Communication for chats and project refresh
- **Claude CLI Integration** - Process spawning and management
- **Session Management** - JSONL parsing and conversation persistence
- **File System API** - Exposing file browser for projects
- **🆕 Checkpoint Management** - File state capture and restoration system
- **🆕 Message Truncation** - Server-side conversation history management

### Frontend (React + Vite)
- **React 18** - Modern component architecture with hooks
- **CodeMirror** - Advanced code editor with syntax highlighting
- **🆕 Enhanced Tools Settings** - Comprehensive tool configuration interface
- **🆕 Checkpoint UI** - Visual checkpoint creation and revert functionality





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


## Support & Community

### Stay Updated
- **Star** this repository to show support
- **Watch** for updates and new releases
- **Follow** the project for announcements

---

<div align="center">
  <strong>Made with care for the Claude Code community</strong>
</div>