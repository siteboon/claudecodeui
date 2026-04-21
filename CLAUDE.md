# CLAUDE.md

This is the Startino fork of CloudCLI UI, running on `<host>` from `<app_checkout>`.
Instances run as `claudecodeui@<user>` systemd services, one Unix user per UI login/workspace.
Each instance has its own `$HOME`, Claude sessions, CloudCLI auth DB, frontend dist dir, and port.
The reverse proxy exposes each instance at `/<user>/` on the private tailnet URL.
Project folders may be systemd `BindPaths`; check the service unit before assuming a GUI path is a normal clone.
The shared UI checkout may also be bind-mounted into selected user workspaces for live customization.
Run the host setup script from the servers repo, currently `<servers_repo>/hosts/<host>/claudecodeui/setup.sh`.
For NixOS changes use `<servers_repo>/update.sh`; commit and push UI changes in this repo.
