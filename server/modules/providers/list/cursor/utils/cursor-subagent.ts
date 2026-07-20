import path from 'node:path';

const UUID_RE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const AGENT_ID_JSON_RE = new RegExp(`"agentId"\\s*:\\s*"(${UUID_RE})"`, 'gi');
const AGENT_ID_TEXT_RE = new RegExp(`Agent ID:\\s*(${UUID_RE})`, 'gi');

export type CursorSubagentPathInfo = {
  sessionId: string;
  parentProviderSessionId: string;
};

/**
 * Detects the classic Cursor layout:
 * `…/agent-transcripts/<parent>/subagents/<child>.jsonl`
 */
export function parseCursorSubagentTranscriptPath(filePath: string): CursorSubagentPathInfo | null {
  const normalized = path.normalize(filePath);
  const parts = normalized.split(path.sep);
  const subagentsIndex = parts.lastIndexOf('subagents');
  if (subagentsIndex <= 0) {
    return null;
  }

  const parentProviderSessionId = parts[subagentsIndex - 1];
  const fileName = parts[parts.length - 1] || '';
  if (!fileName.endsWith('.jsonl') || !parentProviderSessionId) {
    return null;
  }

  const sessionId = path.basename(fileName, '.jsonl');
  if (!sessionId || sessionId === parentProviderSessionId) {
    return null;
  }

  return { sessionId, parentProviderSessionId };
}

/**
 * Extracts Cursor Task subagent ids from a store.db JSON blob / tool result.
 */
export function extractCursorAgentIds(payload: string): string[] {
  const found = new Set<string>();

  for (const regex of [AGENT_ID_JSON_RE, AGENT_ID_TEXT_RE]) {
    regex.lastIndex = 0;
    let match = regex.exec(payload);
    while (match) {
      if (match[1]) {
        found.add(match[1]);
      }
      match = regex.exec(payload);
    }
  }

  return [...found];
}

/**
 * Pulls a single agentId from a Task tool result envelope when present.
 */
export function extractAgentIdFromToolResult(toolResult: unknown): string | null {
  if (!toolResult || typeof toolResult !== 'object') {
    return null;
  }

  const record = toolResult as Record<string, unknown>;
  const direct = record.agentId ?? record.agent_id;
  if (typeof direct === 'string' && direct.trim()) {
    return direct.trim();
  }

  const nested = record.toolUseResult;
  if (nested && typeof nested === 'object') {
    const nestedRecord = nested as Record<string, unknown>;
    const nestedId = nestedRecord.agentId ?? nestedRecord.agent_id;
    if (typeof nestedId === 'string' && nestedId.trim()) {
      return nestedId.trim();
    }
  }

  const content = record.content;
  if (typeof content === 'string') {
    const ids = extractCursorAgentIds(content);
    return ids[0] ?? null;
  }

  try {
    return extractCursorAgentIds(JSON.stringify(toolResult))[0] ?? null;
  } catch {
    return null;
  }
}
