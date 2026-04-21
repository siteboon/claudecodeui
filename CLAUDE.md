# CLAUDE.md

This is the Startino fork of CloudCLI UI, running on Pluto from `/srv/claudecodeui`.
The NixOS services are `claudecodeui@config`, `claudecodeui@jorge`, and `claudecodeui@jonas`.
Each service has its own Unix user, home dir, Claude sessions, CloudCLI auth DB, and port.
Tailscale Serve exposes them as `/config/`, `/jorge/`, and `/jonas/`.
Shared project access uses systemd `BindPaths`, so `/home/config/servers` appears as `~/servers` in user GUIs.
The live UI checkout is also bind-mounted into Jorge's GUI at `/home/jorge/startino/claudecodeui`.
Build and setup script: `/home/config/servers/hosts/pluto/claudecodeui/setup.sh`.
For NixOS changes use `/home/config/servers/update.sh`; commit and push UI changes here.
