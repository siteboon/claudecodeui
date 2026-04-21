# CLAUDE.md

This is the Startino fork of CloudCLI UI, running on `<host>` from the shared checkout `<app_checkout>`.
Production runs one `claudecodeui@<user>` systemd service per UI instance.
Each instance has its own Unix user, `$HOME`, Claude sessions, CloudCLI auth DB, dist dir, and port.
The reverse proxy exposes each instance at `/<user>/` on the private tailnet URL.
The checkout visible in a GUI workspace may be a systemd `BindPaths` mount of the live shared checkout.
Build outputs are per instance, for example `<dist_dir_for_user>`, while server code is shared.
Deployment scripts and NixOS units live outside this repo in the infrastructure repo.
Commit and push UI changes in this repo; deploy through the host setup flow after changes.
