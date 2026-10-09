# Features

## Codex Chat/Shell handoff

Codex Chat waits for its retained Shell writer to exit before resuming. Shell startup is blocked during an active Chat turn, and Chat abort waits for SDK shutdown. CloudCLI launches Codex Shell with `--disable daemon_auto_start` so a shared background daemon does not retain the thread writer after the terminal exits. This coordinates CloudCLI-owned terminals; independently opened clients must release their own writers.

## Review hardening

Codex Shell remains tracked until its PTY actually exits, including after a handoff timeout. Edits release Shell before rewinding history. Chat abort reports a shutdown timeout after 10 seconds without marking the run complete; retry stopping it before opening Shell. Periodic cleanup retains aborted sessions until the SDK run actually finishes. Existing graceful exit and daemon settings are unchanged.
