# Phase 3 — Auto-naming (Haiku titler)

## Goal
Every Claude Code session gets an AI-generated 3–5 word title. No more `admiring-payne-e269b9`.
Cache in existing `session_names.custom_name` column. Chokidar watches for new JSONL files;
60-second idle trigger avoids titling live sessions mid-sentence.

## Repo location
Worktree `/Users/home/src/Dispatch-wt-3` on branch `feat/auto-naming`.

## Files to CREATE
- `server/services/session-titler.js` — the worker (chokidar watcher + titling queue + Haiku call)
- `server/services/title-prompt.js` — the prompt template (stolen from open-webui, adapted)

## Files to TOUCH
- `server/index.js` — add one line: `require('./services/session-titler').start();` at boot. **No other edits.**
- `src/components/sidebar/subcomponents/SidebarSessionItem.tsx` — if a session's `custom_name` is pending (flag it somehow), render with `.shimmer` animation on the placeholder

## Algorithm
1. On server boot:
   - Scan `~/.claude/projects/**/*.jsonl`
   - For each file: check if `session_names` has a row where `session_id=<file-basename>` and `provider='claude'` and `custom_name` is non-null. If yes, skip. If no, enqueue.
2. Chokidar watches `~/.claude/projects/**/*.jsonl`:
   - On `add` or `change`: debounce 60s per file (reset timer on each event)
   - When timer fires: enqueue for titling
3. Worker processes queue serially (one title at a time, low priority):
   - Read file, take first 2 non-system user messages (reuse filter at `projects.js:829` via require — no edit to projects.js)
   - Truncate combined content to 1500 chars
   - Call Haiku via existing `@anthropic-ai/claude-agent-sdk`:
     ```js
     const title = await query({
       model: 'claude-haiku-4-5',
       system: titlePromptTemplate,
       messages: [{ role: 'user', content: truncated }],
       max_tokens: 20,
     });
     ```
   - Parse: expect single line, strip quotes, 3–5 words. Reject if >8 words or contains newlines; default to "Untitled" on reject.
   - Upsert into `session_names(session_id, provider='claude', custom_name, created_at)`
   - Emit WebSocket event so sidebar updates live

## Title prompt template (borrowed from open-webui, simplified)
```
You generate 3-5 word titles for coding chat conversations.

Rules:
- 3 to 5 words only
- Title Case
- No quotation marks
- Specific and action-oriented: "Fix login redirect bug", "Refactor auth middleware", "Add OAuth scopes"
- Never generic: not "Chat 1", not "Discussion", not "Question"
- No emoji, no markdown
- If the conversation is about a specific file or feature, name it

Respond with only the title, nothing else.
```

## Cost
~500 input + 10 output tokens Haiku = ~$0.0005/title. One-time cost for existing ~1000 sessions ≈ $0.50. Ongoing ≈ $0.01/week.

## Acceptance criteria
1. Restart server: within 5 min all existing sessions have titles (visible in sidebar)
2. Start a new `claude` session on the CLI, send 2 messages, close it → within 2 min the session appears in sidebar with a title (not a hash)
3. Sidebar displays `.shimmer` animation while title is pending
4. No regression in existing session list; unchanged files unchanged
5. `npm run build` + tests pass
6. Cost stays under $1 for initial backfill (verify by counting sessions * $0.0005)

## Test plan
1. Unit: feed known fixture JSONLs → assert generated title roughly matches expected (title case, 3–5 words, non-generic)
2. Integration: nuke `session_names.custom_name` rows for test projects, boot server, verify they repopulate
3. Smoke: watch sidebar, tail server log to confirm no errors
