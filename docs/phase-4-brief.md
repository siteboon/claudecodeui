# Phase 4 — Topic clustering

## Goal
Within each project (repo), cluster conversations by topic. Small projects (<20 convos) use Haiku
tagging; large projects use Voyage embeddings + HDBSCAN. Topics surface in the sidebar as a middle
layer between Project and Conversation.

## Repo location
Worktree `/Users/home/src/Dispatch-wt-4` on branch `feat/topics`. Run only after Phase 3 merges
(this phase needs titles).

## Files to CREATE
- `server/database/migrations/001_conversation_topics.sql` — new table
  ```sql
  CREATE TABLE IF NOT EXISTS conversation_topics (
    session_id TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'claude',
    project_key TEXT NOT NULL,
    topic TEXT NOT NULL,
    accent TEXT,                  -- pastel assigned for this topic within its project
    assigned_at INTEGER NOT NULL, -- unix ms
    method TEXT NOT NULL,         -- 'haiku' or 'hdbscan'
    PRIMARY KEY (session_id, provider)
  );
  CREATE INDEX idx_ct_project ON conversation_topics(project_key);
  ```
- `server/services/topic-clusterer.js` — main clusterer with both strategies
- `server/services/topic-prompt.js` — Haiku tagging prompt
- `server/services/embeddings-client.js` — Voyage API wrapper (env var `VOYAGE_API_KEY`)
- Nightly cron: `server/services/topic-clusterer-cron.js` registers a `node-cron` job for 3am local

## Files to TOUCH
- `server/index.js` — one line: `require('./services/topic-clusterer-cron').start();`
- Sidebar tree (created in Phase 2): render `Topic` level between Project and Conversation

## Algorithm

### Triggers
- On new session title (WebSocket event from Phase 3's titler): re-tag that session only (cheap Haiku call)
- Nightly cron at 3am: re-tag projects where convos >= 20 using HDBSCAN; projects with <20 skip (Haiku tags are stable enough)
- Manual user action: drag conversation onto a Topic in sidebar → override, insert row with `method='manual'` (never overwritten by automatic runs)

### Small-project strategy (Haiku tagging, <20 convos)
For each untagged session in a project:
1. Fetch the title + first user message (already in session data)
2. Fetch the existing topics in this project (distinct `topic` column rows)
3. Prompt Haiku:
   ```
   You assign topic tags to coding chat conversations.

   Existing topics in this project: [list]
   Conversation title: [title]
   First message: [1000 chars]

   Assign ONE topic. Prefer an existing topic if it fits. Otherwise invent a new topic (2-3 words, Title Case).
   Examples: "Auth", "Tests", "Deploy Flakiness", "Refactor Data Layer"
   Respond with only the topic name.
   ```
4. Insert row; if new topic, assign a pastel accent (round-robin through `sky, mint, peach, lavender, butter, blush`, checking existing accents in that project)

### Large-project strategy (embeddings + HDBSCAN, >=20 convos)
1. Collect titles + first-message previews for all convos in the project
2. Batch-embed via Voyage voyage-3-lite (cheap, 200 dims)
3. Run HDBSCAN with `min_cluster_size=3`, `min_samples=2` — use `hdbscan-ts` npm package or shell out to a Python script (lighter = ts pkg; fall back to Python if ts pkg doesn't exist in 2026)
4. For each cluster: pull the 5 closest titles, prompt Haiku to name the cluster
5. Overwrite rows where `method != 'manual'` with new clusterings

### Topic UI
Mobile: horizontal `.ds-chip` scroll row above conversation list. Tap chip → filter. Active chip uses `-active` modifier.

Desktop: collapsible sidebar section headers. Topic header = chip style with count badge. Expand/collapse state persisted in localStorage.

## Cost
- Haiku tagging per untagged convo: ~$0.0005
- Voyage embeddings voyage-3-lite: $0.02 / 1M tokens. 1000 titles × 30 tokens = 30k tokens = ~$0.0006 per full re-embed
- HDBSCAN is free (local CPU)
- Daily cost: negligible

## Acceptance criteria
1. After running: every session has exactly one topic
2. Pastels assigned consistently: the same topic within a project always gets the same pastel accent
3. Dragging a conversation to another topic survives reload + overrides automatic classification (method='manual')
4. Projects with <20 convos show topics that look coherent ("Auth", "Tests", "Refactor", etc.)
5. Projects with >=20 convos run HDBSCAN nightly; clusters change if new conversations shift the landscape
6. No regression to Phase 2's sidebar tree; topic layer slots cleanly in

## Env vars needed
- `VOYAGE_API_KEY` — orchestrator to prompt user if absent (via morning summary follow-up) or skip large-project HDBSCAN until set
