# Features

## Codex CLI Model Discovery

Chat obtains visible Codex models, display names, the default model, and supported reasoning efforts through the existing CLI's `app-server model/list` protocol, including pagination. Discovery uses the same CLI launcher as existing app-server operations and never opens or resumes a conversation.

Results are cached in memory for 60 seconds with concurrent requests coalesced. Visible Codex Chat checks every minute and on window focus or returning to the tab. Existing supported selections and custom model rows remain available. Failures retain the last successful catalog, or the bundled catalog before the first successful query, and retry after cache expiry. No additional credentials or model catalog are persisted by CloudCLI.
