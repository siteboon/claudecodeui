# Features

- Claude chat now uses `dontAsk` instead of `bypassPermissions` when CloudCLI is started as `root` and either skip-permissions or the chat mode button requests bypass mode, preventing Claude SDK chat exits with code 1.
- Regression coverage is available via `npm run test:claude-sdk-permissions`, which rebuilds `dist-server` before running the permission-mode test.
