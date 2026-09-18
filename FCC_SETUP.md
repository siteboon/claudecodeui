# FCC / Claude Code UI setup

The former `claude/fcc-server-sa7lcd` branch was merged into `main` and removed.
Use `main` after the deployment repair is merged. Do not use the old checkout command.

## Start on your computer

Install and start Docker Desktop (Windows/macOS) or Docker Engine with Compose
(Linux). In a terminal:

```bash
git clone https://github.com/sjbrenchley89/claudecodeui.git
cd claudecodeui
git switch codex/fcc-deployment-repair
docker compose up -d --build
docker compose ps
```

For an existing checkout, save any uncommitted edits first, then use `git fetch
origin` and switch to the repair branch. Do not clone over an existing directory.

Open http://localhost:3001 on that computer and complete the initial account setup.
The image health check calls `/health`; wait for `docker compose ps` to show
`healthy`. View startup errors with `docker compose logs --tail=100 cloudcli`.

## Data and agent access

- SQLite data: `cloudcli_data`, mounted at `/var/lib/cloudcli`.
- Agent settings, credentials and history: `cloudcli_home`, at `/home/nodejs`.
- Project files: `cloudcli_projects`, at `/workspace`.

These are named volumes, prefixed with the Compose project name. Stop with
`docker compose down` without `--volumes` to keep them. Authenticate the desired
provider through its supported setup flow before expecting Claude/Codex sessions
to work. A healthy web UI alone does not verify provider authentication or billing.
The container does not automatically inherit agent logins from the host computer.

For local source projects, add an explicit bind mount to `/workspace` in a Compose
override after choosing the host directory. Until then, files in `/workspace`
belong to the persistent Docker volume.

The previous Compose file mounted a volume at `/root/.cloudcli`, despite running
as a different user. If you previously used it, back up and inspect both its old
volume and container before recreating them. No automatic data migration is provided.

## Access from your phone

The app is bound to the computer's loopback address. `localhost` on your phone
refers to your phone, not the computer. Set up an authenticated private connection
such as Tailscale Serve or an HTTPS reverse proxy on the computer before using it
remotely. Keep the computer awake and online. The laptop must be online in Remote
Desktop Commander for remote setup work to continue from ChatGPT.

## Linux deployment script

`bash deploy.sh deploy` uses a host directory `/var/lib/cloudcli` for the database,
plus `cloudcli-home` and `cloudcli-projects` named volumes. It is a separate setup
from Compose; choose one method. It needs Docker and curl, plus sudo when not root.
Keep real credentials in your local config, never in a Git commit. The script pins
the container's port, bind address and database location to match its mount setup.

## Build verification

```bash
npm ci
npm run build
```

Development dependencies are required to build. The Docker builder installs them
and removes them only after compiling. The runtime image includes the scripts used
by `npm run server`. `.dockerignore` excludes local credentials, data, dependencies
and old build outputs from the image build context.
