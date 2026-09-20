# Daily Report

Daily Report provides a global, evidence-linked summary of activity recorded today across CloudCLI projects and providers. Open it from the sidebar and choose **Generate report**. Opening the dialog only reads the in-memory cache; it never invokes a model.

## Coverage and safety

- Claude, Codex, Cursor, and OpenCode are supported as history sources through the existing normalized session service.
- Claude and Codex can generate summaries. Claude runs as an ephemeral Agent SDK query with built-in tools disabled, no MCP servers, no skills or settings sources, two structured-output protocol turns, and session persistence disabled. Codex runs in a temporary working directory with a read-only sandbox, approvals disabled, and web search disabled.
- If the selected provider is unavailable, times out, or returns invalid evidence references, generation fails clearly so a conversation list is never presented as an LLM summary.
- Each summarizer reuses its CLI's existing local endpoint, credentials, and default model (`~/.claude/settings.json` or `~/.codex/config.toml` and `auth.json`); no duplicate Daily Report API configuration is required.
- Each work item contains the work performed, current progress (including an explicit completed state), and the next step.
- The top summary is returned as 3-8 distinct highlights instead of one dense paragraph.
- Report output supports Simplified Chinese, Traditional Chinese, English, Japanese, Korean, French, German, Spanish, Brazilian Portuguese, and Russian.
- Message text is bounded and common credentials are redacted before summarization. Messages with invalid or explicitly synthetic timestamps are excluded.
- Every AI item must cite evidence from the current snapshot. The server rejects invented evidence IDs and never accepts model-generated navigation URLs.

## Limits

Collection is bounded to the 20 most recently indexed candidate conversations, 2,000 messages per conversation, four concurrent readers, and five seconds per conversation. Reaching a bound is reported as partial coverage. The in-memory cache keeps at most 50 reports for 30 minutes and is lost on restart.

The open-source session index currently has installation-wide visibility rather than project ACLs. Cache keys still include the authenticated user scope, and cached source IDs are revalidated before being returned.

## API

- `GET /api/daily-reports/today?timezone=Asia%2FShanghai&locale=zh-CN` reads cached state.
- `POST /api/daily-reports/generate` accepts `date`, `timezone`, `locale`, optional `model`, and `summaryProvider: "claude" | "codex"`.

The MVP accepts only the current natural date in the supplied IANA timezone.
