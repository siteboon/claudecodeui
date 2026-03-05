# Project Stats — example plugin

Scans the currently selected project and shows file counts, lines of code, a file-type breakdown chart, largest files, and recently modified files.

This is the example plugin that ships with Claude Code UI. It demonstrates all three plugin capabilities in a way that's immediately useful. See the sections below for the full plugin authoring guide.

## How plugins work

A plugin's UI is a plain ES module loaded directly into the host app — no iframe. Plugins can optionally declare a `server` entry in their manifest — a Node.js script that the host runs as a subprocess. The module calls the server through an `api.rpc()` helper (the host proxies the calls using its own auth token).

```
┌─────────────────────────────────────────────────────────┐
│  Host server                                            │
│                                                         │
│  Lifecycle:                                             │
│    git clone / git pull      Install & update           │
│    npm install               Dependency setup           │
│                                                         │
│  Runtime:                                               │
│    GET  /api/plugins                List plugins        │
│    GET  /api/plugins/:name/assets/* Serve static files  │
│    ALL  /api/plugins/:name/rpc/*    Proxy → subprocess  │
│    PUT  /api/plugins/:name/enable   Toggle + start/stop │
│    DELETE /api/plugins/:name        Uninstall + stop    │
│                                                         │
│  Plugin subprocess (server.js):                         │
│    Runs as a child process with restricted env           │
│    Listens on random local port                         │
│    Receives secrets via X-Plugin-Secret-* headers       │
└───────────┬─────────────────────────┬───────────────────┘
            │ serves static files     │ proxies RPC
┌───────────▼─────────────────────────▼───────────────────┐
│  Frontend (browser)                                     │
│                                                         │
│  Plugin module (index.js)                               │
│    import(url) → mount(container, api)                  │
│    api.context          — theme / project / session     │
│    api.onContextChange  — subscribe to changes          │
│    api.rpc(method, path, body) → Promise                │
└─────────────────────────────────────────────────────────┘
```

## Plugin structure

```
my-plugin/
  manifest.json   # Required — plugin metadata
  index.js        # Frontend entry point (ES module, mount/unmount exports)
  server.js       # Optional — backend entry point (runs as subprocess)
  package.json    # Optional — npm dependencies for server.js
```

All files in the plugin directory are accessible via `/api/plugins/:name/assets/`.

## manifest.json

```jsonc
{
  "name": "hello-world",        // Unique id — alphanumeric, hyphens, underscores only
  "displayName": "Hello World", // Shown in the UI
  "version": "1.0.0",
  "description": "Short description shown in settings.",
  "author": "Your Name",
  "icon": "Puzzle",             // Lucide icon name (see available icons below)
  "type": "module",             // "module" (default) or "iframe" (legacy)
  "slot": "tab",                // Where the plugin appears — only "tab" is supported today
  "entry": "index.js",          // Frontend entry file, relative to plugin directory
  "server": "server.js",        // Optional — backend entry file, runs as Node.js subprocess
  "permissions": []             // Reserved for future use
}
```

### Available icons

`Puzzle` (default), `Box`, `Database`, `Globe`, `Terminal`, `Wrench`, `Zap`, `BarChart3`, `Folder`, `MessageSquare`, `GitBranch`

## Installation

**Manual:** Copy your plugin folder into `~/.claude-code-ui/plugins/`.

**From git:** In Settings > Plugins, paste a git URL and click Install. The repo is cloned into the plugins directory.

---

## Frontend — Module API

The host dynamically imports your entry file and calls `mount(container, api)`. When the plugin tab is closed or the plugin is disabled, `unmount(container)` is called.

```js
// index.js

export function mount(container, api) {
  // api.context — current snapshot: { theme, project, session }
  // api.onContextChange(cb) — subscribe, returns an unsubscribe function
  // api.rpc(method, path, body?) — call the plugin's server subprocess

  container.innerHTML = '<p>Hello!</p>';

  const unsub = api.onContextChange((ctx) => {
    container.style.background = ctx.theme === 'dark' ? '#111' : '#fff';
  });

  container._cleanup = unsub;
}

export function unmount(container) {
  if (typeof container._cleanup === 'function') container._cleanup();
  container.innerHTML = '';
}
```

### Context object

```js
api.context // always up to date
// {
//   theme:   "dark" | "light",
//   project: { name: string, path: string } | null,
//   session: { id: string, title: string } | null,
// }
```

### RPC helper

```js
// Calls /api/plugins/:name/rpc/hello via the host's authenticated fetch
const data = await api.rpc('GET', '/hello');

// With a JSON body
const result = await api.rpc('POST', '/echo', { greeting: 'hi' });
```

---

## Backend — Server subprocess

Plugins that need to make authenticated API calls, use npm packages, or run Node.js logic can declare a `"server"` entry in their manifest. The host manages the full lifecycle:

### How it works

1. When the plugin is enabled, the host spawns `node server.js` as a child process
2. The subprocess **must** print a JSON line to stdout: `{"ready": true, "port": 12345}`
3. The host records the port and proxies requests from `/api/plugins/:name/rpc/*` to it
4. When the plugin is disabled or uninstalled, the host sends SIGTERM to the process

### Restricted environment

The subprocess runs with a **minimal env** — only `PATH`, `HOME`, `NODE_ENV`, and `PLUGIN_NAME`. It does **not** inherit the host's API keys, database URLs, or other secrets from `process.env`.

### Secrets

Per-plugin secrets are stored in `~/.claude-code-ui/plugins.json` and injected as HTTP headers on every proxied request:

```json
{
  "hello-world": {
    "enabled": true,
    "secrets": {
      "apiKey": "sk-live-..."
    }
  }
}
```

The plugin's server receives these as `x-plugin-secret-apikey` headers — they are per-call, never stored in the subprocess env.

### Example server.js

```js
const http = require('http');

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');

  // Read host-injected secrets
  const apiKey = req.headers['x-plugin-secret-apikey'];

  if (req.method === 'GET' && req.url === '/hello') {
    res.end(JSON.stringify({ message: 'Hello!', hasApiKey: Boolean(apiKey) }));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

// Listen on a random port and signal readiness
server.listen(0, '127.0.0.1', () => {
  const { port } = server.address();
  console.log(JSON.stringify({ ready: true, port }));
});
```

---

## Frontend — Mobile

On desktop, each enabled plugin gets its own tab in the tab bar. On mobile, plugins are grouped under a single "More" button in the bottom navigation to save space.

## Security

### Frontend isolation

Plugin modules run in the same JS context as the host app but have no access to auth tokens or internal state — only the `api` object passed to `mount`. They cannot make authenticated API calls directly; all server communication goes through `api.rpc()`, which the host proxies.

### Server subprocess isolation

The subprocess runs as a separate OS process with:

- **Restricted env** — no host secrets inherited; only `PATH`, `HOME`, `NODE_ENV`, `PLUGIN_NAME`
- **Per-call secrets** — injected as HTTP headers by the host proxy, never stored in process env
- **Process boundary** — a crash in the plugin cannot crash the host
- **Auth stripping** — the host removes `authorization` and `cookie` headers before proxying

The subprocess runs as the same OS user, so it has the same filesystem/network access. This matches the trust model of VS Code extensions, Grafana backend plugins, and Terraform providers — the user explicitly installs the plugin.

### Install-time protections

npm `postinstall` scripts are blocked during installation (`--ignore-scripts`). Plugins that need npm packages should ship pre-built or use packages that work without postinstall hooks.

## Try it

```bash
cp -r examples/plugins/hello-world ~/.claude-code-ui/plugins/
```

Then open Settings > Plugins — "Project Stats" should appear. Enable it, select a project, and open its tab to see the stats.
