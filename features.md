# Features

## Shared Codex CLI

Set `CODEX_CLI_PATH=/usr/local/bin/codex` (or another executable path) in the CloudCLI service environment to use the same CLI for Chat, Shell, and app-server operations. Restart CloudCLI after changing this setting. Updating that executable applies to newly started runs; already running processes retain their version. Without this setting, each integration uses the packaged Codex runtime. This selects a shared executable; it does not automatically install CLI or SDK updates.
