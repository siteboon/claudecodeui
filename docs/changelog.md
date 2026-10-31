# Changelog

## 1.37.5

### 2026-10-18

- Merge upstream main (`0ce5630f`) and resolve the CLI help conflict by retaining both the shared `CODEX_CLI_PATH` setting and the updated `CONTEXT_WINDOW` fallback description. Shared CLI selection and literal shell path quoting remain intact.

## 1.37.3

### 2026-10-12

- Derive PowerShell path expectations from the normalized CLI entry and exercise Windows path joining on Linux as well as Windows hosts. This fixes the bundled start/resume test expectations without changing production launch behavior.
- Group dated manual records under a single version heading. Keep generated release notes separate.

### 2026-10-09

- Configured Codex paths, the Node executable, and the bundled CLI entry are quoted as literal Bash/PowerShell arguments. Spaces, apostrophes, variables, command substitutions, and backticks in paths cannot expand into commands.
- Add regression coverage for review findings. Move manual records to `docs/changelog.md` and reserve root `CHANGELOG.md` for release-it to avoid case-insensitive filename collisions and duplicate release entries.


### 2026-10-08

- Set `CODEX_CLI_PATH=/usr/local/bin/codex` (or another executable path) in the CloudCLI service environment to use the same CLI for Chat, Shell, and app-server operations. Restart CloudCLI after changing this setting. Updating that executable applies to newly started runs; already running processes retain their version. Without this setting, each integration uses the packaged Codex runtime. This selects a shared executable; it does not automatically install CLI or SDK updates.
