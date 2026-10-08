# Local Changelog

## 2026-10-08

- Use the bundled Codex CLI in Shell as well as Chat so a newer global CLI daemon cannot retain the thread writer after terminal exit.

- Fix Codex active-writer conflicts when switching from Shell to Chat; guard Shell startup while Chat is running.
