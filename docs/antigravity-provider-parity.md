# Antigravity and Codex feature parity

The comparison target is the Codex chat integration in CloudCLI. Features are
enabled through the provider capability matrix and the existing runtime,
session, model, MCP, skills, and synchronization interfaces.

| Surface | Codex | Antigravity |
| --- | --- | --- |
| New chats, resume, streaming, reconnect and off-screen replies | Supported | Supported |
| Edit a persisted prompt using the pencil, then resend | Supported | Native step anchor, independent prefix snapshot, common edit gateway |
| Whole-session and message-point forks | Supported | Independent native SQLite snapshot and artifacts |
| Model picker and per-session model changes | Supported | Account-specific native catalog, refreshed on read |
| Reasoning effort, saved per session and browser default | Supported | `--effort`; only available sibling variants or declared custom levels |
| Custom model library and custom effort metadata | Supported | Common model library and provider validation |
| Image and file uploads, paste/drop, restored history cards | Supported | Common validated file references; native file/image tools read the assets |
| Live tool invocation, arguments, output and failures | Supported | Native stream-json tool events, deduplicated by step |
| Persisted thinking and tool activity | Supported | Native planner thinking and calls, paired transcript results |
| Live and restored token counts | Supported | Native counters, with cached input/thinking already included |
| Stop a managed run | Supported | Process ownership retained until exit, with escalation |
| Persisted follow-up queue and send admission | Supported | Common queue; also waits for externally owned AGY turns |
| Side questions and independent cancellation | Supported | Independent read-only snapshot and restricted agent |
| External CLI activity and busy-session protection | Supported on Linux | Same-user exclusive presence lock plus native busy status |
| Rename, archive/delete, projects, search, export, notifications | Common services | Common services |
| Shell, executable override, version/auth status, MCP and skills | Supported | Provider adapters; `AGY_CLI_PATH` applies consistently |
| Interactive permission requests | Not exposed | Not exposed by the stream-json transport; permission modes/rules apply |
| Inject a message into the current turn (Steer) | Not exposed | Not exposed; use Queue or Stop/Send |

The CLI's documented stream-json input accepts text blocks only. Attachment
paths therefore use the existing Cursor-style envelopes rather than sending
image blocks the CLI rejects. Assets remain subject to native tool permissions.
This differs from Codex's structured local-image input.

Prefix snapshots validate storage and filter generation/executor caches by the
steps their payloads reference, **not by cache row numbers**. Original native
conversations are preserved and superseded app mappings are recorded only after
the snapshot succeeds. Editing the first prompt starts a fresh native thread.
Unknown schemas, malformed cache references, inherited parent references and
battle-mode histories are rejected without changing the session mapping. Like
Codex, editing conversation history does not roll back workspace file changes.

Reported token counts are session/request usage, not subscription quota. No
context-window size or remaining plan allowance is inferred. Fixed-effort models
have no effort picker. Native background-subagent controls, workflow timelines,
service-tier controls, voice, and account quota are not invented when the runtime
does not provide the corresponding common contract.

Primary CLI contracts:

- [Headless input, tool events and token counters](https://antigravity.google/docs/cli/headless/)
- [Effort levels and per-invocation override](https://antigravity.google/docs/cli/commands/effort/)
- [ACP for native snapshot load verification](https://antigravity.google/docs/cli/acp)
