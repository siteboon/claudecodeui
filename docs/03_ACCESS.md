# Access — Main Install (fork)

This file documents how to reach, start, stop, and operate the **only** claudecodeui install on **192.168.1.19** (the Claude VM): the fork `szmidtpiotr/claudecodeui`, running in **dev mode (Vite HMR)** under systemd. The original `siteboon` install was removed on 2026-05-26.

Last updated: 2026-05-26.

---

## URLs

| What | URL | Notes |
|---|---|---|
| **Frontend (dev, HMR)** | http://192.168.1.19:5173 | Vite dev server, hot-reloads on edits. This is the URL you browse. |
| Backend (API + WS) | http://192.168.1.19:3001 | Express + WebSocket; Vite proxies `/api`, `/ws`, `/shell` here |

For remote access, NGINX Proxy Manager (on 192.168.1.4) fronts `code-dev.studio-colorbox.com` → the Vite port (5173). `VITE_ALLOWED_HOSTS` in `.env` must list that hostname.

## Port allocation

| Port | Owner |
|---|---|
| **3001** | Fork backend (Express) — main install |
| **5173** | Fork Vite dev frontend (HMR) — main install |
| **4000** | Docsify docs site (`docsify-docs.service`) — serves this `docs/` folder |
| 8080 | code-server (unrelated) |
| 4723 | Appium (unrelated) |

There is no longer a second install. To change ports, edit `/home/claude/projects/claudecodeui/.env` then `sudo systemctl restart claudecodeui`.

---

## Paths

| Path | Role |
|---|---|
| `/home/claude/projects/claudecodeui` | **Source tree** (this repo, branch `main`, remote = `szmidtpiotr/claudecodeui`) |
| `/home/claude/.claude/` | Claude Code's data directory — read/written by both the UI and the `claude` CLI |
| `/etc/systemd/system/claudecodeui.service` | systemd unit (runs `npm run dev` as user `claude`) |

`.env` lives at `/home/claude/projects/claudecodeui/.env`. It is `.gitignore`'d.

---

## Starting and stopping (systemd, dev mode)

The install runs under systemd as `claudecodeui.service`, executing `npm run dev` (Vite HMR + tsx server via `concurrently`). It auto-starts on boot and restarts on failure. **Editing source files hot-reloads live** — you do NOT need to restart the service to see code changes.

```bash
sudo systemctl status claudecodeui      # state
sudo systemctl restart claudecodeui     # full restart (only needed for .env / dep changes)
sudo systemctl stop claudecodeui        # stop
sudo systemctl start claudecodeui       # start
sudo journalctl -u claudecodeui -f      # live logs (HMR + server output)
```

Restart is only needed when changing `.env`, installing dependencies, or editing `vite.config.js` / server bootstrap. Ordinary `src/` and `server/` edits hot-reload.

---

## Docs site (Docsify)

These `docs/` markdown files are also served as a browsable site via Docsify (CDN-based, no build step).

- **URL:** http://192.168.1.19:4000
- **Service:** `docsify-docs.service` (systemd, enabled, runs `docsify serve docs/ -p 4000`)
- **Loader files:** `docs/index.html`, `docs/.nojekyll` (+ auto-generated `docs/_sidebar.md`)
- Editing any `.md` here updates the site on browser refresh — no restart needed.

```bash
sudo systemctl restart docsify-docs   # only after editing index.html
sudo journalctl -u docsify-docs -f
```

The Docsify server has no host allowlist, so it works behind any proxy hostname (e.g. point `docs.studio-colorbox.com` at port 4000).

### Auto-generated navigation

`_sidebar.md` is **generated automatically** — do not edit it by hand. A second service watches this folder and regenerates the sidebar (and keeps the docsify homepage valid) whenever a `.md` file is added, renamed, deleted, or its `# H1` changes.

- **Script:** `docs/gen-sidebar.sh` (`./gen-sidebar.sh` once, or `--watch` to follow changes; polls every 1s)
- **Service:** `docsify-sidebar.service` (systemd, enabled, runs `gen-sidebar.sh --watch`)
- **Ordering:** sidebar order follows filename sort, so numeric prefixes control it — `00_TO_DO.md`, `01_README.md`, `02_ARCHITECTURE.md`, `03_ACCESS.md`.
- **Labels:** taken from each file's first `# H1` heading (falls back to the filename).
- **Homepage:** auto-pointed at the `*README*` file (currently `01_README.md`), so the site root keeps working even after renames.

```bash
sudo systemctl restart docsify-sidebar
sudo journalctl -u docsify-sidebar -f
```

To add a page: drop a new `NN_Name.md` into `docs/` with a `# Title` heading — it appears in the nav within ~1s (refresh the browser).

---

## Host and SSH

- Runs on **192.168.1.19** (the Claude VM), user `claude`. Passwordless `sudo` and SSH from this VM.
- This VM is where Claude (the agent) executes — file edits in `/home/claude/projects/claudecodeui/` are local writes.

---

## Shared `~/.claude/` data — important

The UI reads/writes the same `/home/claude/.claude/` directory the `claude` CLI uses (sessions, projects, settings, MCP cache). **Editing the UI's source code does not alter conversation transcripts** — those are JSONL files the UI only reads/displays. But **actions taken through the UI** (starting/continuing a session, editing files, changing settings) operate on that shared data and are real Claude Code activity, identical to using the CLI.

If full isolation is ever needed: export a different home / `CLAUDE_*` env vars in the systemd unit before `npm run dev`. Not configured today.

---

## Git remotes

- **Fork (this repo, origin):** `https://github.com/szmidtpiotr/claudecodeui.git` — push your changes here.
- **Upstream (original):** `https://github.com/siteboon/claudecodeui.git` — add as a second remote to pull upstream changes:
  ```bash
  git remote add upstream https://github.com/siteboon/claudecodeui.git
  git fetch upstream
  ```

Initial clone was a shallow fetch (`--depth=1`). Run `git fetch --unshallow` if you need full history.

---

## Quick smoke tests

```bash
curl -s -o /dev/null -w "frontend %{http_code}\n" http://192.168.1.19:5173/   # expect 200
curl -s -o /dev/null -w "backend  %{http_code}\n" http://192.168.1.19:3001/   # expect 302 (auth redirect)
```
