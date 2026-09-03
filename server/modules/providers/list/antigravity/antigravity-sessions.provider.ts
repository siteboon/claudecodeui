/**
 * Antigravity Sessions Provider
 *
 * Implements IProviderSessions for the Antigravity CLI (agy).
 * Handles message normalization from live stream-json events and loads history
 * from transcript JSONL log files.
 *
 * @module antigravity-sessions.provider
 */

import { readFile } from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

import { parseFilesInputTag, parseImagesInputTag } from '@/shared/image-attachments.js';
import type { IProviderSessions } from '@/shared/interfaces.js';
import type {
  AnyRecord,
  FetchHistoryOptions,
  FetchHistoryResult,
  NormalizedMessage,
  ProviderSessionUsageInput,
  ProviderTokenUsageResult,
} from '@/shared/types.js';
import {
  AppError,
  createNormalizedMessage,
  generateMessageId,
  normalizeProjectPath,
  parseAntigravityWorkspacePath,
  readObjectRecord,
  readOptionalString,
  readUsageNumber,
  removePathIfExists,
  sanitizeLeafDirectoryName,
  sliceTailPage,
} from '@/shared/utils.js';

import {
  getAntigravityBrainRoots,
  getAntigravityDataRoot,
  getAntigravitySummariesDbPath,
  getAntigravityTranscriptCandidates,
} from './antigravity-data-root.js';

const PROVIDER = 'antigravity';

/**
 * Finds the transcript.jsonl file for a session across possible brain directories.
 */
function findTranscriptPath(sessionId: string): string | null {
  const safeId = sanitizeLeafDirectoryName(sessionId, 'antigravity session id');

  for (const candidate of getAntigravityTranscriptCandidates(safeId)) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Reads a usage snapshot from one Antigravity transcript.jsonl.
 *
 * Transcripts carry the usage either on a `result` event or on bare
 * total/input/output lines. When no explicit usage was recorded the transcript
 * is re-scanned and characters are estimated at ~3 chars/token so long
 * conversations still show a ballpark figure instead of zeros.
 */
function readAntigravityTokenUsage(fileContent: string): ProviderTokenUsageResult {
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  const lines = fileContent.trim().split('\n');

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const entry = JSON.parse(lines[index]) as AnyRecord;
      const usage = entry.usage
        ?? entry.result?.usage
        ?? (entry.event === 'result' ? entry.result?.usage : null)
        ?? (entry.payload?.usage)
        ?? null;

      if (usage) {
        inputTokens = readUsageNumber(usage.input_tokens ?? usage.inputTokens ?? usage.prompt_tokens);
        outputTokens = readUsageNumber(usage.output_tokens ?? usage.outputTokens ?? usage.completion_tokens);
        totalTokens = readUsageNumber(usage.total_tokens ?? usage.totalTokens)
          || (inputTokens + outputTokens);
        break;
      }

      if (typeof entry.total_tokens === 'number' || typeof entry.tokens === 'number') {
        totalTokens = readUsageNumber(entry.total_tokens ?? entry.tokens);
        inputTokens = readUsageNumber(entry.input_tokens ?? entry.prompt_tokens);
        outputTokens = readUsageNumber(entry.output_tokens ?? entry.completion_tokens);
        break;
      }
    } catch {
      // Skip unparseable lines.
    }
  }

  if (totalTokens === 0 && inputTokens === 0 && outputTokens === 0) {
    let estimatedInputChars = 0;
    let estimatedOutputChars = 0;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const entry = JSON.parse(trimmed) as AnyRecord;
        const contentLength = typeof entry.content === 'string' ? entry.content.length : 0;
        const thinkingLength = typeof entry.thinking === 'string' ? entry.thinking.length : 0;
        if (entry.source === 'MODEL' || entry.type === 'PLANNER_RESPONSE') {
          estimatedOutputChars += contentLength + thinkingLength;
        } else {
          estimatedInputChars += contentLength;
        }
      } catch {
        // Skip unparseable lines
      }
    }
    if (estimatedInputChars > 0 || estimatedOutputChars > 0) {
      inputTokens = Math.ceil(estimatedInputChars / 3);
      outputTokens = Math.ceil(estimatedOutputChars / 3);
      totalTokens = inputTokens + outputTokens;
    }
  }

  return {
    used: totalTokens || (inputTokens + outputTokens),
    inputTokens,
    outputTokens,
    breakdown: { input: inputTokens, output: outputTokens },
  };
}

function cleanToolArgValue(val: unknown): unknown {
  if (typeof val !== 'string') return val;
  const trimmed = val.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return val;
}

/**
 * Strips outer quoted strings that Antigravity CLI occasionally emits in transcript tool arguments.
 */
export function normalizeAntigravityToolArgs(args: unknown): AnyRecord {
  const record = readObjectRecord(args);
  if (!record) return {};
  const cleaned: AnyRecord = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === 'string') {
      cleaned[key] = cleanToolArgValue(value);
    } else if (Array.isArray(value)) {
      cleaned[key] = value.map(cleanToolArgValue);
    } else if (value && typeof value === 'object') {
      cleaned[key] = normalizeAntigravityToolArgs(value);
    } else {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

/**
 * Normalizes one step or event from Antigravity CLI stream-json or transcript logs.
 */
export class AntigravitySessionsProvider implements IProviderSessions {
  /**
   * Normalizes live stream-json events or objects into NormalizedMessage array.
   */
  normalizeMessage(rawMessage: unknown, sessionId: string | null): NormalizedMessage[] {
    const raw = readObjectRecord(rawMessage);
    if (!raw) {
      if (typeof rawMessage === 'string' && rawMessage.trim()) {
        return [createNormalizedMessage({
          kind: 'stream_delta',
          content: rawMessage,
          sessionId,
          provider: PROVIDER,
        })];
      }
      return [];
    }

    const messages: NormalizedMessage[] = [];

    // 1. Live stream-json event: init
    if (raw.event === 'init' && raw.init) {
      const initData = readObjectRecord(raw.init);
      const conversationId = readOptionalString(raw.conversation_id) ?? sessionId;
      messages.push(createNormalizedMessage({
        kind: 'session_created',
        sessionId: conversationId,
        newSessionId: conversationId,
        provider: PROVIDER,
        content: `Session initialized: ${conversationId}`,
      }));
      return messages;
    }

    // 2. Live stream-json event: step_update
    if (raw.event === 'step_update' && raw.step_update) {
      const step = readObjectRecord(raw.step_update);
      if (!step) return [];

      const stepType = readOptionalString(step.step_type);
      const state = readOptionalString(step.state);
      const textDelta = readOptionalString(step.text_delta);
      const stepIndex = typeof step.step_index === 'number' ? step.step_index : undefined;

      // Agent streaming text delta
      if (stepType === 'agent_response' && textDelta) {
        messages.push(createNormalizedMessage({
          id: generateMessageId(PROVIDER),
          kind: 'stream_delta',
          content: textDelta,
          sessionId,
          provider: PROVIDER,
          sequence: stepIndex,
        }));
      }

      // Tool use initiation
      if (stepType === 'tool' && state === 'ACTIVE') {
        const toolName = readOptionalString(step.tool_name) || 'tool';
        const toolInfo = readObjectRecord(step.tool_info);
        const parameters = normalizeAntigravityToolArgs(toolInfo?.parameters ?? {});
        const toolId = `tool_${stepIndex ?? Date.now()}`;

        messages.push(createNormalizedMessage({
          id: generateMessageId(PROVIDER),
          kind: 'tool_use',
          toolName,
          toolInput: parameters,
          toolId,
          sessionId,
          provider: PROVIDER,
          sequence: stepIndex,
        }));
      }

      // Tool result completion or error
      if (stepType === 'tool' && (state === 'DONE' || state === 'ERROR')) {
        const toolInfo = readObjectRecord(step.tool_info);
        const toolId = `tool_${stepIndex ?? Date.now()}`;
        const output = readOptionalString(toolInfo?.output) ?? '';
        const isError = state === 'ERROR';

        messages.push(createNormalizedMessage({
          id: generateMessageId(PROVIDER),
          kind: 'tool_result',
          toolId,
          content: isError ? (readOptionalString(toolInfo?.error) ?? 'Tool execution error') : output,
          isError,
          sessionId,
          provider: PROVIDER,
          sequence: stepIndex,
        }));
      }

      return messages;
    }

    // 3. Live stream-json event: result
    if (raw.event === 'result' && raw.result) {
      const resultData = readObjectRecord(raw.result);
      const usageData = readObjectRecord(resultData?.usage);
      const totalTokens = typeof usageData?.total_tokens === 'number' ? usageData.total_tokens : undefined;

      const completeMsg = createNormalizedMessage({
        id: generateMessageId(PROVIDER),
        kind: 'complete',
        sessionId,
        provider: PROVIDER,
        tokens: totalTokens,
      });

      messages.push(completeMsg);
      return messages;
    }

    return messages;
  }

  /**
   * Fetches and paginates history from transcript.jsonl log files.
   *
   * Transcripts live under brain/<provider-native conversation id>, while
   * this method is addressed with the stable app session id; the
   * provider-native id arrives via options and must win over the positional
   * fallback (app-created sessions have distinct ids).
   */
  async fetchHistory(
    sessionId: string,
    options: FetchHistoryOptions = {},
  ): Promise<FetchHistoryResult> {
    const { limit = null, offset = 0 } = options;
    const providerSessionId = options.providerSessionId ?? sessionId;
    const transcriptPath = findTranscriptPath(providerSessionId);

    if (!transcriptPath) {
      return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
    }

    try {
      const content = await readFile(transcriptPath, 'utf8');
      const lines = content.split(/\r?\n/);
      const normalizedMessages: NormalizedMessage[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]?.trim();
        if (!line) continue;

        try {
          const entry = JSON.parse(line) as AnyRecord;
          const type = readOptionalString(entry.type);
          const source = readOptionalString(entry.source);
          const rawContent = readOptionalString(entry.content) ?? '';
          const createdAt = readOptionalString(entry.created_at) ?? new Date().toISOString();
          const stepIndex = typeof entry.step_index === 'number' ? entry.step_index : i;
          const baseId = `msg_${sessionId}_${stepIndex}`;

          // User prompt
          if (type === 'USER_INPUT' || source === 'USER_EXPLICIT') {
            // Clean prompt wrapper tags like <USER_REQUEST>...</USER_REQUEST>
            let cleanText = rawContent
              .replace(/<USER_REQUEST>\s*/g, '')
              .replace(/<\/USER_REQUEST>\s*/g, '')
              .replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/g, '')
              .replace(/<USER_SETTINGS_CHANGE>[\s\S]*?<\/USER_SETTINGS_CHANGE>/g, '')
              .trim();

            const parsedImages = parseImagesInputTag(cleanText);
            const parsedFiles = parseFilesInputTag(parsedImages.text);

            if (parsedFiles.text.trim() || parsedImages.attachments.length > 0) {
              normalizedMessages.push(createNormalizedMessage({
                id: baseId,
                sessionId,
                timestamp: createdAt,
                provider: PROVIDER,
                kind: 'text',
                role: 'user',
                content: parsedFiles.text,
                images: parsedImages.attachments.length > 0 ? parsedImages.attachments : undefined,
                files: parsedFiles.attachments.length > 0 ? parsedFiles.attachments : undefined,
                sequence: stepIndex,
              }));
            }
            continue;
          }

          // Planner entries carry either tool invocations or the assistant's
          // reply text. Real transcripts emit replies as PLANNER_RESPONSE
          // content without tool_calls (GENERIC only appears for background
          // task status), so both shapes must be handled here.
          if (type === 'PLANNER_RESPONSE') {
            if (Array.isArray(entry.tool_calls) && entry.tool_calls.length > 0) {
              for (let t = 0; t < entry.tool_calls.length; t++) {
                const tc = entry.tool_calls[t] as AnyRecord;
                const toolName = readOptionalString(tc?.name) || 'tool';
                const args = normalizeAntigravityToolArgs(tc?.args ?? {});
                const toolId = `tool_${stepIndex}_${t}`;

                normalizedMessages.push(createNormalizedMessage({
                  id: `${baseId}_tc_${t}`,
                  sessionId,
                  timestamp: createdAt,
                  provider: PROVIDER,
                  kind: 'tool_use',
                  toolName,
                  toolInput: args,
                  toolId,
                  sequence: stepIndex,
                }));
              }
            } else if (rawContent) {
              normalizedMessages.push(createNormalizedMessage({
                id: baseId,
                sessionId,
                timestamp: createdAt,
                provider: PROVIDER,
                kind: 'text',
                role: 'assistant',
                content: rawContent,
                sequence: stepIndex,
              }));
            }
            continue;
          }

          // Remaining MODEL entries are tool results (RUN_COMMAND, VIEW_FILE,
          // CODE_ACTION, LIST_DIRECTORY, GREP_SEARCH, ...) or GENERIC
          // background-task output. Result entries arrive in call order, so
          // pair each with the oldest tool_use still missing its result.
          if (source === 'MODEL' && rawContent) {
            const pendingToolUse = normalizedMessages.find(
              (msg) => msg.kind === 'tool_use' && !msg.toolResult,
            );
            if (pendingToolUse) {
              pendingToolUse.toolResult = {
                content: rawContent,
                isError: entry.status === 'ERROR'
                  || (typeof entry.exit_code === 'number' && entry.exit_code !== 0),
              };
            } else {
              // Nothing to pair with (task status without a visible call):
              // surface the content as assistant text instead of dropping it.
              normalizedMessages.push(createNormalizedMessage({
                id: baseId,
                sessionId,
                timestamp: createdAt,
                provider: PROVIDER,
                kind: 'text',
                role: 'assistant',
                content: rawContent,
                sequence: stepIndex,
              }));
            }
          }
        } catch {
          // Ignore corrupted lines
        }
      }

      const total = normalizedMessages.length;
      const { page, hasMore } = sliceTailPage(normalizedMessages, limit, offset);

      let tokenUsage: unknown = undefined;
      const brainDir = path.resolve(transcriptPath, '../../..');
      const tokenUsagePath = path.join(brainDir, 'token_usage.json');
      if (fs.existsSync(tokenUsagePath)) {
        try {
          const rawUsage = await readFile(tokenUsagePath, 'utf8');
          tokenUsage = JSON.parse(rawUsage);
        } catch {
          // Fall back gracefully
        }
      }

      return {
        messages: page,
        total,
        hasMore,
        offset,
        limit,
        tokenUsage,
      };
    } catch (error) {
      console.warn(`[AntigravitySessions] Failed to load history for ${sessionId}:`, error);
      return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
    }
  }

  /**
   * Reads the token usage for one Antigravity session.
   *
   * Consumer: the provider token-usage service. A persisted
   * `token_usage.json` in the session's brain directory wins (written by the
   * quota feature with exact counters); otherwise usage is parsed from the
   * transcript. The transcript is located via the app row's indexed
   * `jsonl_path` when it still exists, then via the brain directory lookup.
   */
  async getTokenUsage(input: ProviderSessionUsageInput): Promise<ProviderTokenUsageResult> {
    const indexedFilePath = input.jsonlPath && fs.existsSync(input.jsonlPath)
      ? input.jsonlPath
      : null;
    const sessionFilePath = indexedFilePath ?? findTranscriptPath(input.nativeSessionId);

    if (!sessionFilePath) {
      throw new AppError(`Antigravity session file for "${input.appSessionId}" was not found.`, {
        code: 'ANTIGRAVITY_SESSION_FILE_NOT_FOUND',
        statusCode: 404,
      });
    }

    // Check for persisted token_usage.json in session's brain directory
    const brainDir = path.resolve(sessionFilePath, '../../..');
    const tokenUsagePath = path.join(brainDir, 'token_usage.json');
    if (fs.existsSync(tokenUsagePath)) {
      try {
        const usageRaw = await readFile(tokenUsagePath, 'utf8');
        const usageJson = JSON.parse(usageRaw) as ProviderTokenUsageResult | null;
        if (usageJson && typeof usageJson.used === 'number') {
          return usageJson;
        }
      } catch {
        // Fall back to reading the transcript file.
      }
    }

    const fileContent = await readFile(sessionFilePath, 'utf8');
    return readAntigravityTokenUsage(fileContent);
  }

  /**
   * Cleans up Antigravity native storage (summary DB row, brain directory, and conversations directory).
   */
  async cleanupSession(nativeSessionId: string, jsonlPath?: string | null): Promise<boolean> {
    let removed = false;

    if (jsonlPath) {
      if (await removePathIfExists(jsonlPath)) {
        removed = true;
      }
    }

    const summariesDbPath = getAntigravitySummariesDbPath();
    if (fs.existsSync(summariesDbPath)) {
      let db: Database.Database | null = null;
      try {
        db = new Database(summariesDbPath);
        const res = db.prepare('DELETE FROM conversation_summaries WHERE conversation_id = ?').run(nativeSessionId);
        if (res.changes > 0) {
          removed = true;
        }
      } catch (err) {
        console.warn('[AntigravitySessions] Failed to delete Antigravity summary row:', err);
      } finally {
        if (db) {
          db.close();
        }
      }
    }

    if (nativeSessionId) {
      try {
        const safeId = sanitizeLeafDirectoryName(nativeSessionId, 'antigravity session id');
        const dataRoot = getAntigravityDataRoot();

        // 1. Clean up brain directories (current and legacy roots)
        for (const brainRoot of getAntigravityBrainRoots()) {
          const brainDir = path.join(brainRoot, safeId);
          if (await removePathIfExists(brainDir)) {
            removed = true;
          }
        }

        // 2. Clean up conversation DB files (.db, .db-wal, .db-shm) and directories if any
        const convDbPath = path.join(dataRoot, 'conversations', `${safeId}.db`);
        if (await removePathIfExists(convDbPath)) {
          removed = true;
        }
        await removePathIfExists(`${convDbPath}-wal`);
        await removePathIfExists(`${convDbPath}-shm`);

        const convDir = path.join(dataRoot, 'conversations', safeId);
        if (await removePathIfExists(convDir)) {
          removed = true;
        }

        // 3. Clean up lock files in presence/
        const lockPath = path.join(dataRoot, 'presence', `${safeId}.lock`);
        if (await removePathIfExists(lockPath)) {
          removed = true;
        }
      } catch {
        // Skip if safeId is invalid
      }
    }

    return removed;
  }

  /**
   * Cleans up Antigravity native storage for an entire project path.
   */
  async cleanupProjectStorage(projectPath: string): Promise<void> {
    const normalizedPath = normalizeProjectPath(projectPath);
    if (!normalizedPath || normalizedPath === path.parse(normalizedPath).root) {
      return;
    }

    const summariesDbPath = getAntigravitySummariesDbPath();
    const matchingConversationIds: string[] = [];
    if (fs.existsSync(summariesDbPath)) {
      let db: Database.Database | null = null;
      try {
        db = new Database(summariesDbPath);
        const rows = db.prepare('SELECT conversation_id, workspace_uris FROM conversation_summaries').all() as Array<{
          conversation_id: string;
          workspace_uris: string | null;
        }>;

        for (const row of rows) {
          if (!row.workspace_uris) {
            continue;
          }
          const ws = parseAntigravityWorkspacePath(row.workspace_uris);
          if (ws && normalizeProjectPath(ws) === normalizedPath) {
            matchingConversationIds.push(row.conversation_id);
            db.prepare('DELETE FROM conversation_summaries WHERE conversation_id = ?').run(row.conversation_id);
          }
        }
      } catch (err) {
        console.warn('[AntigravitySessions] Failed to clean up Antigravity workspace summaries:', err);
      } finally {
        if (db) {
          db.close();
        }
      }
    }

    const dataRoot = getAntigravityDataRoot();
    const brainRoots = getAntigravityBrainRoots();
    for (const convId of matchingConversationIds) {
      try {
        const safeId = sanitizeLeafDirectoryName(convId, 'conversation id');
        for (const brainRoot of brainRoots) {
          await removePathIfExists(path.join(brainRoot, safeId));
        }

        const convDbPath = path.join(dataRoot, 'conversations', `${safeId}.db`);
        await removePathIfExists(convDbPath);
        await removePathIfExists(`${convDbPath}-wal`);
        await removePathIfExists(`${convDbPath}-shm`);
        await removePathIfExists(path.join(dataRoot, 'conversations', safeId));
        await removePathIfExists(path.join(dataRoot, 'presence', `${safeId}.lock`));
      } catch {
        // Ignore invalid leaf directory names
      }
    }
  }
}
