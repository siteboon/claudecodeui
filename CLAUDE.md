# CLAUDE.md

Startino fork of CloudCLI UI. On Pluto, one `claudecodeui@<user>` systemd
unit runs per UI instance — currently `config`, `jorge`, and `jonas`.

Each unit runs from its own checkout at `/home/<user>/claudecodeui` via
`npm run dev` (NODE_ENV=development), which concurrently runs:

- `vite` for the client: full HMR — edits under `src/` reach the browser
  without a restart.
- `tsx server/index.js` for the Node server: no `--watch`, so server-side
  changes need a restart to take effect.

Each instance has its own `$HOME`, Claude sessions under `$HOME/.claude/`,
CloudCLI auth DB at `$HOME/.cloudcli/auth.db`, and separate `SERVER_PORT` /
`VITE_PORT`. The tailnet reverse proxy exposes each at `/<user>/`.

Restart an instance to pick up server-side changes:

    sudo systemctl restart claudecodeui@<user>

Commit and push UI changes to `origin/main` before asking another instance
to pull them.
