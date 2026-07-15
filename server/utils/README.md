# server/utils/childProcessEnv.js

## Overview

`NODE_ENV=production` commonly ends up in a Node server's own environment — Heroku's Node.js buildpack sets it automatically by default, and it's standard boilerplate in hand-rolled systemd units and Dockerfiles. This app's own code never reads `NODE_ENV` at runtime, but any child process the server spawns inherits whatever's in its environment by default unless explicitly stripped. When `NODE_ENV=production` leaks into `npm`/`npx` invocations specifically, those tools silently skip installing `devDependencies`, breaking builds, lint, and typecheck in ways that are confusing to debug from the resulting error alone. Deployments that never set `NODE_ENV` (e.g. this project's documented bare `pm2 start` production instructions) aren't affected by the underlying issue, and applying this fix is a no-op for them.

## The problem

Spawning child processes with an unfiltered `{ ...process.env }` spread — or passing `process.env` directly as `env` — carries `NODE_ENV` along with everything else. This mistake was found at multiple spawn sites across the codebase, first via a small pass tracing specific bug reports, then via a full audit of every `spawn`/`exec` call in the repo. See "Current usage" below for the current site count and coverage caveats.

## Usage

Whenever this codebase spawns a child process — via `spawn`, `exec`, `execFile`, `execSync`, `execFileSync`, or any wrapper around them — build its `env` with `buildChildProcessEnv()` instead of spreading or referencing `process.env` directly. This applies regardless of which of Node's child_process functions you're using; the leak isn't specific to `spawn()`.

```js
// Don't, in any of these forms:
spawn('npm', ['install'], { env: { ...process.env } });
execSync('git clone ...', { env: process.env });
execFile('rg', args, { env: { ...process.env, EXTRA: 'value' } });

// Do:
import { buildChildProcessEnv } from '../utils/childProcessEnv.js'; // adjust to your file's actual relative path
spawn('npm', ['install'], { env: buildChildProcessEnv() });
```

The import path above is only `./childProcessEnv.js` for files already inside `server/utils/` — everywhere else, adjust it to the correct relative path to `server/utils/childProcessEnv.js`.

It returns a copy of `process.env` with `NODE_ENV` removed. Pass an optional object to add or override specific keys on top of the cleaned environment:

```js
env: buildChildProcessEnv({ TERM: 'xterm-256color' })
```

## Current usage

| File | What it spawns |
|---|---|
| `server/claude-sdk.js` | Claude Code agent sessions |
| `server/cursor-cli.js` | Cursor agent sessions |
| `server/opencode-cli.js` | OpenCode agent sessions |
| `server/index.js` | Self-update (`npm install` / `git pull`) |
| `server/routes/taskmaster.js` | `task-master` install check, version, and PRD-parsing subprocesses |
| `server/utils/commandParser.js` | Allowlisted user-invoked commands |
| `server/utils/plugin-loader.js` | Plugin `npm install`/`npm run build` and git clone/pull |
| `server/modules/browser-use/browser-use.service.ts` | browser-use install/runtime commands |
| `server/modules/websocket/services/shell-websocket.service.ts` | Interactive terminal (PTY) shell sessions |
| `server/utils/gitConfig.js` | System git config reads |
| `server/routes/git.js` | Git operations issued from the Git panel |
| `server/routes/user.js` | Per-user git subprocess helper |
| `server/routes/agent.js` | Git remote/log/clone/checkout/push for the external agent API |
| `server/modules/projects/services/project-clone.service.ts` | `git clone` for new projects |
| `server/shared/claude-cli-path.ts` | Windows Claude CLI path resolution |
| `server/modules/providers/list/claude/claude-auth.provider.ts` | Claude CLI install check |
| `server/modules/providers/list/codex/codex-auth.provider.ts` | Codex CLI install check |
| `server/modules/providers/list/cursor/cursor-auth.provider.ts` | Cursor CLI install check and status |
| `server/modules/providers/list/cursor/cursor-models.provider.ts` | Cursor model listing |
| `server/modules/providers/list/opencode/opencode-auth.provider.ts` | OpenCode CLI install check |
| `server/modules/providers/list/opencode/opencode-models.provider.ts` | OpenCode model listing |
| `server/modules/providers/services/session-conversations-search.service.ts` | ripgrep session search |
| `electron/localServer.js` | Owned local server process |
| `electron/main.js` | SSH terminal launch (macOS) |
| `electron/serverInstaller.js` | Server bundle extraction |
| `scripts/release/build-server-bundle.js` | Release bundle dependency install/rebuild |

**Total known sites: 48** (16 fixed before this audit + 32 found in a
full audit of every `spawn`/`exec`/`execSync`/`execFile*` call in
`server/`, `electron/`, and `scripts/`). That audit was more thorough
than the first pass, but per-site verification status still varies —
treat the PR description's table as the source of truth for individual
site status, not this summary count.

## Note on plugin-process-manager.js

`server/utils/plugin-process-manager.js`'s `buildPluginEnv()` had the same `NODE_ENV` leak and was fixed too, but it intentionally does not use `buildChildProcessEnv()`. It builds env from scratch as a curated allowlist (not a `process.env` spread), so it drops `NODE_ENV` inline instead — routing an allowlist through `buildChildProcessEnv()` would widen it into a full-env passthrough.
