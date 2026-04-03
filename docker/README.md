# Claude Code UI — Docker Sandbox Templates

Run AI coding agents with a full web IDE inside [Docker Sandboxes](https://docs.docker.com/ai/sandboxes/).

Instead of a terminal-only experience, get a browser-based interface with chat, file explorer, git panel, shell, and MCP configuration — all running safely inside an isolated sandbox.

## Available Templates

| Template | Base Image | Agent |
|----------|-----------|-------|
| `cloudcli-ai/sandbox:claude-code` | `docker/sandbox-templates:claude-code` | Claude Code |
| `cloudcli-ai/sandbox:codex` | `docker/sandbox-templates:codex` | OpenAI Codex |
| `cloudcli-ai/sandbox:gemini` | `docker/sandbox-templates:gemini` | Gemini CLI |

## Quick Start

### 1. Start a sandbox with the template

```bash
sbx run --template docker.io/cloudcli-ai/sandbox:claude-code claude ~/my-project
```

### 2. Forward the UI port

```bash
sbx ports <sandbox-name> --publish 3001:3001
```

### 3. Open the browser

```
http://localhost:3001
```

On first visit you'll set a password — this protects the UI if the port is ever exposed beyond localhost.

## What You Get

- **Chat** — Rich conversation UI with markdown rendering, code blocks, and message history
- **Files** — Visual file tree with syntax-highlighted editor
- **Git** — Diff viewer, staging, branch switching, and commit — all visual
- **Shell** — Built-in terminal emulator
- **MCP** — Configure Model Context Protocol servers through the UI
- **Mobile** — Works on tablet and phone browsers

## Building Locally

All Dockerfiles share scripts from `shared/`. Build with the `docker/` directory as context:

```bash
# Claude Code variant
docker build -f docker/claude-code/Dockerfile -t cloudcli-sandbox:claude-code docker/

# Codex variant
docker build -f docker/codex/Dockerfile -t cloudcli-sandbox:codex docker/

# Gemini variant
docker build -f docker/gemini/Dockerfile -t cloudcli-sandbox:gemini docker/
```

## How It Works

Each template extends Docker's official sandbox base image and adds:

1. **Node.js 22** — Runtime for Claude Code UI
2. **Claude Code UI** — Installed globally via `npm install -g @cloudcli-ai/cloudcli`
3. **Auto-start** — The UI server starts in the background when the sandbox shell opens (port 3001)

The agent (Claude Code, Codex, or Gemini) comes from the base image. Claude Code UI connects to it and provides the web interface on top.

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `SERVER_PORT` | `3001` | Port for the web UI |
| `HOST` | `0.0.0.0` | Bind address |
| `DATABASE_PATH` | `~/.cloudcli/auth.db` | SQLite database location |

## Network Policies

If your sandbox uses restricted network policies, allow the UI port:

```bash
sbx policy allow network "localhost:3001"
```

## License

These templates are free and open-source under the same license as Claude Code UI (AGPL-3.0-or-later).
