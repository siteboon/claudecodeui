# `docs/` — Fork working notes

Working documentation for the `claudecodeui` fork (`szmidtpiotr/claudecodeui`). These docs are for the contributor (and for Claude in future sessions), not for end-users of the app.

## Files

- **[ACCESS.md](./ACCESS.md)** — How to reach the fork: URLs, ports, paths, services, start/stop commands, and the shared-state warning about `~/.claude/`. Read this first when picking up the project.
- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — Full structural map of the codebase: backend layout, frontend layout, provider abstraction, real-time layer, auth model, env vars, build pipeline, hot spots, and risks. Read this before making non-trivial changes.

## Add as you go

Suggested files to create when the work calls for them — don't pre-create them:

- `CHANGES.md` — running log of changes the fork makes vs upstream, with rationale.
- `BACKLOG.md` — things you want to do but haven't started.
- `RUNBOOK.md` — recurring operational tasks (rebuild, port migration, DB reset, etc.).

Keep `docs/` for **fork-specific** notes. Upstream-relevant docs (general README updates, CHANGELOG entries) stay at the repo root.
