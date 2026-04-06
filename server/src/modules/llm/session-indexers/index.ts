import type { ISessionIndexer } from '@/modules/llm/session-indexers/session-indexer.interface.js';
import { ClaudeSessionIndexer } from '@/modules/llm/session-indexers/claude.session-indexer.js';
import { CodexSessionIndexer } from '@/modules/llm/session-indexers/codex.session-indexer.js';
import { CursorSessionIndexer } from '@/modules/llm/session-indexers/cursor.session-indexer.js';
import { GeminiSessionIndexer } from '@/modules/llm/session-indexers/gemini.session-indexer.js';

/**
 * Provider-specific session indexers used by the sync orchestrator.
 */
export const sessionIndexers: ISessionIndexer[] = [
  new ClaudeSessionIndexer(),
  new CodexSessionIndexer(),
  new CursorSessionIndexer(),
  new GeminiSessionIndexer(),
];
