<!-- Docker Hub short description (100 chars max): -->
<!-- Sandbox templates for running AI coding agents with a web & mobile IDE (Claude Code, Codex, Gemini) -->

# Sandboxed coding agents with a web & mobile IDE (CloudCLI)

[Docker Sandbox](https://docs.docker.com/ai/sandboxes/) templates that add [CloudCLI](https://cloudcli.ai) on top of Claude Code, Codex, and Gemini CLI. You get a full web and mobile IDE accessible from any browser on any device.

## Get started

### 1. Install the sbx CLI

Docker Sandboxes run agents in isolated microVMs. Install the `sbx` CLI:

- **macOS**: `brew install docker/tap/sbx`
- **Windows**: `winget install -h Docker.sbx`
- **Linux**: `sudo apt-get install docker-sbx`

Full instructions: [docs.docker.com/ai/sandboxes/get-started](https://docs.docker.com/ai/sandboxes/get-started/)

### 2. Store your API key

`sbx` manages credentials securely — your API key never enters the sandbox. Store it once:

```bash
sbx login
sbx secret set -g anthropic
```

### 3. Launch Claude Code

```bash
npx @cloudcli-ai/cloudcli@latest sandbox ~/my-project
```

Open **http://localhost:3001**. Set a password on first visit. Start building.

### Using a different agent

Store the matching API key and pass `--agent`:

```bash
# OpenAI Codex
sbx secret set -g openai
npx @cloudcli-ai/cloudcli@latest sandbox ~/my-project --agent codex

# Gemini CLI
sbx secret set -g google
npx @cloudcli-ai/cloudcli@latest sandbox ~/my-project --agent gemini
```

### Available templates

| Agent | Template |
|-------|----------|
| **Claude Code** (default) | `docker.io/cloudcliai/sandbox:claude-code` |
| OpenAI Codex | `docker.io/cloudcliai/sandbox:codex` |
| Gemini CLI | `docker.io/cloudcliai/sandbox:gemini` |

These are used with `--template` when running `sbx` directly (see [Advanced usage](#advanced-usage)).

## Managing sandboxes

```bash
sbx ls                               # List all sandboxes
sbx stop my-project                  # Stop (preserves state)
sbx start my-project                 # Restart a stopped sandbox
sbx rm my-project                    # Remove everything
sbx exec my-project bash             # Open a shell inside the sandbox
```

If you install CloudCLI globally (`npm install -g @cloudcli-ai/cloudcli`), you can also use:

```bash
cloudcli sandbox ls
cloudcli sandbox start my-project    # Restart and re-launch web UI
cloudcli sandbox logs my-project     # View server logs
```

## What you get

- **Chat** — Markdown rendering, code blocks, message history
- **Files** — File tree with syntax-highlighted editor
- **Git** — Diff viewer, staging, branch switching, commits
- **Shell** — Built-in terminal emulator
- **MCP** — Configure Model Context Protocol servers visually
- **Mobile** — Works on tablet and phone browsers

Your project directory is mounted bidirectionally — edits propagate in real time, both ways.

## Configuration

Set variables at creation time with `--env`:

```bash
npx @cloudcli-ai/cloudcli@latest sandbox ~/my-project --env SERVER_PORT=8080
```

Or inside a running sandbox:

```bash
sbx exec my-project bash -c 'echo "export SERVER_PORT=8080" >> /etc/sandbox-persistent.sh'
```

Restart CloudCLI for changes to take effect:

```bash
sbx exec my-project bash -c 'pkill -f "server/index.js"'
sbx exec -d my-project cloudcli start --port 3001
```

| Variable | Default | Description |
|----------|---------|-------------|
| `SERVER_PORT` | `3001` | Web UI port |
| `HOST` | `0.0.0.0` | Bind address (must be `0.0.0.0` for `sbx ports`) |
| `DATABASE_PATH` | `~/.cloudcli/auth.db` | SQLite database location |

## Advanced usage

For branch mode, multiple workspaces, memory limits, or the terminal agent experience, use `sbx` with the template:

```bash
# Terminal agent + web UI
sbx run --template docker.io/cloudcliai/sandbox:claude-code claude ~/my-project --name my-project
sbx ports my-project --publish 3001:3001

# Branch mode (Git worktree isolation)
sbx run --template docker.io/cloudcliai/sandbox:claude-code claude ~/my-project --branch my-feature

# Multiple workspaces
sbx run --template docker.io/cloudcliai/sandbox:claude-code claude ~/project ~/shared-libs:ro

# Pass a prompt directly
sbx run --template docker.io/cloudcliai/sandbox:claude-code claude ~/my-project -- "Fix the auth bug"
```

CloudCLI auto-starts via `.bashrc` when using `sbx run`.

Full options in the [Docker Sandboxes usage guide](https://docs.docker.com/ai/sandboxes/usage/).

## Network policies

Sandboxes restrict outbound access by default. To reach host services from inside the sandbox:

```bash
sbx policy allow network localhost:11434
# Inside the sandbox: curl http://host.docker.internal:11434
```

The web UI itself doesn't need a policy — access it via `sbx ports`.

## Links

- [CloudCLI Cloud](https://cloudcli.ai) — fully managed, no setup required
- [Documentation](https://cloudcli.ai/docs) — full configuration guide
- [Discord](https://discord.gg/buxwujPNRE) — community support
- [GitHub](https://github.com/siteboon/claudecodeui) — source code and issues

## License

AGPL-3.0-or-later
