# Development

This project is a web UI for the Claude Code CLI (React + Vite frontend, Node/Express + WebSocket server).

On the shared host (`pluto`), each teammate runs a systemd-managed instance out of their own `$HOME/claudecodeui` checkout, on a dedicated port pair and with a per-user `BASE_PATH` reverse-proxied at `/<user>/`.

On a laptop / solo machine, run the standard Vite + server pair on the default ports from `.env.example`.

## Start the dev environment

```
npm install
npm run dev
```

`npm run dev` uses `concurrently` to start both:
- `npm run server:dev` — Express API + WebSocket server (via `tsx`, default `SERVER_PORT=3001`)
- `npm run client` — Vite dev server (default `VITE_PORT=5173`)

Copy `.env.example` to `.env` and tweak ports, `HOST`, `BASE_PATH`, `DATABASE_PATH`, and `ALLOWED_HOSTS` to match your setup.

## Services

- **Frontend** (Vite) — serves the React UI. Default: `http://localhost:5173/`. Respects `BASE_PATH` when set (e.g. `http://localhost:5002/jorge/`).
- **Backend** (Express + WS) — serves `/api/*` HTTP endpoints and a WebSocket endpoint. Default: `http://localhost:3001`. The frontend proxies `/api` and WS traffic to this server via Vite.
- **Auth DB** — SQLite file at `DATABASE_PATH` (default `~/.cloudcli/auth.db`). Stores local user credentials, API keys, and tokens.

## Verify

- `curl -s http://localhost:<SERVER_PORT>/api/auth/status` should return JSON like `{"needsSetup": ..., "isAuthenticated": ...}`.
- Open the frontend URL in a browser.

## Notes

- On the shared `pluto` host each user instance is managed by systemd (`claudecodeui@<user>.service`); do NOT `npm run dev` there — restart the service via `scripts/deploy-pluto.sh` instead.
