# Local Features

## Codex Chat/Shell handoff

Shell uses the bundled Codex CLI, matching Chat's SDK runtime rather than the global CLI and its independently managed daemon.

Chat releases the same session's retained Codex terminal and waits for process exit before resuming. Opening Shell during an active Chat response reports that the response must be stopped first.
