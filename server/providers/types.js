/**
 * Provider Types & Interface
 *
 * Defines the normalized message format and the provider adapter interface.
 * All providers normalize their native formats into NormalizedMessage
 * before sending over REST or WebSocket.
 *
 * @module providers/types
 */

// ─── Session Provider ────────────────────────────────────────────────────────

/**
 * @typedef {'claude' | 'cursor' | 'codex' | 'gemini' | 'kiro'} SessionProvider
 */

// ─── Message Kind ────────────────────────────────────────────────────────────

/**
 * @typedef {'text' | 'tool_use' | 'tool_result' | 'thinking' | 'stream_delta' | 'stream_end'
 *   | 'error' | 'complete' | 'status' | 'permission_request' | 'permission_cancelled'
 *   | 'session_created' | 'interactive_prompt' | 'task_notification'} MessageKind
 */

// ─── NormalizedMessage ───────────────────────────────────────────────────────

/**
 * @typedef {Object} NormalizedMessage
 * @property {string} id - Unique message id (for dedup between server + realtime)
 * @property {string} sessionId
 * @property {string} timestamp - ISO 8601
 * @property {SessionProvider} provider
 * @property {MessageKind} kind
 *
 * Additional fields depending on kind:
 * - text:                 role ('user'|'assistant'), content, images?
 * - tool_use:             toolName, toolInput, toolId
 * - tool_result:          toolId, content, isError
 * - thinking:             content
 * - stream_delta:         content
 * - stream_end:           (no extra fields)
 * - error:                content
 * - complete:             (no extra fields)
 * - status:               text, tokens?, canInterrupt?
 * - permission_request:   requestId, toolName, input, context?
 * - permission_cancelled: requestId
 * - session_created:      newSessionId
 * - interactive_prompt:   content
 * - task_notification:    status, summary
 */

// ─── Fetch History ───────────────────────────────────────────────────────────

/**
 * @typedef {Object} FetchHistoryOptions
 * @property {string} [projectName] - Project name (required for Claude)
 * @property {string} [projectPath] - Absolute project path (required for Cursor cwdId hash)
 * @property {number|null} [limit] - Page size (null = all messages)
 * @property {number} [offset] - Pagination offset (default: 0)
 */

/**
 * @typedef {Object} FetchHistoryResult
 * @property {NormalizedMessage[]} messages - Normalized messages
 * @property {number} total - Total number of messages in the session
 * @property {boolean} hasMore - Whether more messages exist before the current page
 * @property {number} offset - Current offset
 * @property {number|null} limit - Page size used
 * @property {object} [tokenUsage] - Token usage data (provider-specific)
 */

// ─── Provider Status ────────────────────────────────────────────────────────

/**
 * Result of a provider status check (installation + authentication).
 *
 * @typedef {Object} ProviderStatus
 * @property {boolean} installed - Whether the provider's CLI/SDK is available
 * @property {boolean} authenticated - Whether valid credentials exist
 * @property {string|null} email - User email or auth method identifier
 * @property {string|null} [method] - Auth method (e.g. 'api_key', 'credentials_file')
 * @property {string|null} [error] - Error message if not installed or not authenticated
 */

// ─── Provider Adapter Interface ──────────────────────────────────────────────

/**
 * Every provider adapter MUST implement this interface.
 *
 * @typedef {Object} ProviderAdapter
 *
 * @property {(sessionId: string, opts?: FetchHistoryOptions) => Promise<FetchHistoryResult>} fetchHistory
 *   Read persisted session messages from disk/database and return them as NormalizedMessage[].
 *   The backend calls this from the unified GET /api/sessions/:id/messages endpoint.
 *
 *   Provider implementations:
 *   - Claude: reads ~/.claude/projects/{projectName}/*.jsonl
 *   - Cursor: reads from SQLite store.db (via normalizeCursorBlobs helper)
 *   - Codex:  reads ~/.codex/sessions/*.jsonl
 *   - Gemini: reads from in-memory sessionManager or ~/.gemini/tmp/ JSON files
 *
 * @property {(raw: any, sessionId: string) => NormalizedMessage[]} normalizeMessage
 *   Normalize a provider-specific event (JSONL entry or live SDK event) into NormalizedMessage[].
 *   Used by provider files to convert both history and realtime events.
 */

// ─── Runtime Helpers ─────────────────────────────────────────────────────────

/**
 * Generate a unique message ID.
 * Uses crypto.randomUUID() to avoid collisions across server restarts and workers.
 * @param {string} [prefix='msg'] - Optional prefix
 * @returns {string}
 */
export function generateMessageId(prefix = 'msg') {
  return `${prefix}_${crypto.randomUUID()}`;
}

/**
 * Create a NormalizedMessage with common fields pre-filled.
 * @param {Partial<NormalizedMessage> & {kind: MessageKind, provider: SessionProvider}} fields
 * @returns {NormalizedMessage}
 */
export function createNormalizedMessage(fields) {
  return {
    ...fields,
    id: fields.id || generateMessageId(fields.kind),
    sessionId: fields.sessionId || '',
    timestamp: fields.timestamp || new Date().toISOString(),
    provider: fields.provider,
  };
}
