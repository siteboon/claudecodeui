# server/utils/childProcessEnv.js

## Overview

This app's server process runs with `NODE_ENV=production` in production (correctly, set by its systemd unit). Any child process the server spawns inherits that value by default unless it's explicitly stripped. When `NODE_ENV=production` leaks into `npm`/`npx` invocations, those tools silently skip installing `devDependencies`, which breaks builds, lint, and typecheck in ways that are confusing to debug from the resulting error alone.

## The problem

Spawning child processes with an unfiltered `{ ...process.env }` spread — or passing `process.env` directly as `env` — carries `NODE_ENV` along with everything else. As of this writing, this same mistake had turned up at 10 spawn sites across the codebase. That count came from tracing the original bug reports, not from an exhaustive audit of every `spawn`/`exec` call in the repo — treat it as a snapshot, not a final tally.

## Usage

Whenever this codebase spawns a child process, build its `env` with `buildChildProcessEnv()` instead of spreading or referencing `process.env` directly:

```js
// Don't:
spawn('npm', ['install'], { env: { ...process.env } });

// Do:
import { buildChildProcessEnv } from './childProcessEnv.js';
spawn('npm', ['install'], { env: buildChildProcessEnv() });
```

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
| `server/routes/taskmaster.js` | `task-master` init and PRD-parsing subprocesses |
| `server/utils/commandParser.js` | Allowlisted user-invoked commands |
| `server/utils/plugin-loader.js` | Plugin `npm install` and `npm run build` |
| `server/modules/browser-use/browser-use.service.ts` | browser-use install/runtime commands |
| `server/modules/websocket/services/shell-websocket.service.ts` | Interactive terminal (PTY) shell sessions |

## Note on plugin-process-manager.js

`server/utils/plugin-process-manager.js`'s `buildPluginEnv()` had the same `NODE_ENV` leak and was fixed too, but it intentionally does not use `buildChildProcessEnv()`. It builds env from scratch as a curated allowlist (not a `process.env` spread), so it drops `NODE_ENV` inline instead — routing an allowlist through `buildChildProcessEnv()` would widen it into a full-env passthrough.
