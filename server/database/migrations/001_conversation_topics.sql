-- Phase 4 — conversation_topics table.
--
-- One row per (session_id, provider). `topic` is the cluster name; `accent` is
-- the pastel color assigned to this topic within its project_key. `method`
-- distinguishes 'haiku' (small-project tagger), 'hdbscan' (large-project
-- clusterer), or 'manual' (drag-and-drop override). Manual rows are never
-- overwritten by the automatic runs.
--
-- Loaded at boot by server/database/topic-store.js so installations get the
-- table without a separate migration runner.

CREATE TABLE IF NOT EXISTS conversation_topics (
  session_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'claude',
  project_key TEXT NOT NULL,
  topic TEXT NOT NULL,
  accent TEXT,
  assigned_at INTEGER NOT NULL,
  method TEXT NOT NULL,
  PRIMARY KEY (session_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_ct_project ON conversation_topics(project_key);
CREATE INDEX IF NOT EXISTS idx_ct_topic_project ON conversation_topics(project_key, topic);
