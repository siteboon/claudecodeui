# Codex runtime selection

CloudCLI uses the Codex app-server runtime by default. The default for
non-browser callers is selected with `CLOUDCLI_CODEX_RUNTIME_MODE`, while the
Codex settings panel can override it per request:

| Mode | Behavior |
| --- | --- |
| `app-server` | Use the persistent Codex app-server runtime. |
| `sdk` | Use the direct `@openai/codex-sdk` runtime. |

Unset and invalid values resolve to `app-server`. Set the server default with:

```text
CLOUDCLI_CODEX_RUNTIME_MODE=sdk
```

The settings panel stores the selected mode in the user's preferences and sends
it with each Codex request. There is no automatic retry through a second
runtime, so a failure is reported by the runtime selected for that request.

## Runtime-specific features

The app-server mode provides persistent threads, app-server history, and tool
approval bridging. The SDK mode keeps the direct SDK stream and JSONL history.
Background session indexing always scans JSONL files so it never starts the
managed app-server process. The process starts lazily when app-server chat or
history, forking, message editing, or a manual restart needs it.

The Codex settings panel can restart the managed process after `config.toml` or
`auth.json` changes. Restart waits for the process to stop, performs a fresh
initialize handshake, and refuses to interrupt an active app-server turn.

Both implementations remain available because the user can select either mode
from settings.
