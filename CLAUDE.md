# CLAUDE.md

This repo is the Startino fork of CloudCLI UI, deployed on Pluto from `/srv/claudecodeui`.
Jorge can edit the same live checkout in the GUI at `/home/jorge/startino/claudecodeui`.
Services are `claudecodeui@config`, `claudecodeui@jorge`, and `claudecodeui@jonas`.
They serve `/config/`, `/jorge/`, and `/jonas/` through Tailscale Serve on Pluto.
Frontend builds are per user: `dist-config`, `dist-jorge`, and `dist-jonas`.
Run setup from the servers repo: `/home/config/servers/hosts/pluto/claudecodeui/setup.sh`.
Use `/home/config/servers/update.sh` for NixOS changes, not direct rebuild commands.
Commit and push UI changes to `startino/claudecodeui`.
