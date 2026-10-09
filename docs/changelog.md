# Changelog

## 1.37.3 - 2026-10-09

- Codex Shell remains tracked until its PTY actually exits, including after a handoff timeout. Edits release Shell before rewinding history. Chat abort reports a shutdown timeout after 10 seconds without marking the run complete; retry stopping it before opening Shell. Periodic cleanup retains aborted sessions until the SDK run actually finishes. Existing graceful exit and daemon settings are unchanged.
- Add regression coverage for review findings. Move manual records to `docs/changelog.md` and reserve root `CHANGELOG.md` for release-it to avoid case-insensitive filename collisions and duplicate release entries.


## 1.37.3 - 2026-10-08

- Codex Chat waits for its retained Shell writer to exit before resuming. Shell startup is blocked during an active Chat turn, and Chat abort waits for SDK shutdown. CloudCLI launches Codex Shell with `--disable daemon_auto_start` so a shared background daemon does not retain the thread writer after the terminal exits. This coordinates CloudCLI-owned terminals; independently opened clients must release their own writers.
