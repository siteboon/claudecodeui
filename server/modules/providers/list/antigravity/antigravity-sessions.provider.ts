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
import os from 'node:os';
import path from 'node:path';

import { parseFilesInputTag, parseImagesInputTag } from '@/shared/image-attachments.js';
import type { IProviderSessions } from '@/shared/interfaces.js';
import type {
  AnyRecord,
  FetchHistoryOptions,
  FetchHistoryResult,
  NormalizedMessage,
} from '@/shared/types.js';
import {
  createNormalizedMessage,
  generateMessageId,
  readObjectRecord,
  readOptionalString,
  sanitizeLeafDirectoryName,
  sliceTailPage,
} from '@/shared/utils.js';

const PROVIDER = 'antigravity';

/**
 * Resolves the Antigravity CLI data root (`~/.gemini/antigravity-cli` by
 * default). `CLOUDCLI_ANTIGRAVITY_DATA_DIR` overrides it so tests can point
 * transcript lookups at an isolated fixture tree instead of the real home
 * directory.
 */
function getAntigravityDataRoot(): string {
  return process.env.CLOUDCLI_ANTIGRAVITY_DATA_DIR
    ?? path.join(os.homedir(), '.gemini', 'antigravity-cli');
}

/**
 * Finds the transcript.jsonl file for a session across possible brain directories.
 */
function findTranscriptPath(sessionId: string): string | null {
  const safeId = sanitizeLeafDirectoryName(sessionId, 'antigravity session id');
  const candidates = [
    path.join(getAntigravityDataRoot(), 'brain', safeId, '.system_generated', 'logs', 'transcript.jsonl'),
    path.join(os.homedir(), '.gemini', 'antigravity', 'brain', safeId, '.system_generated', 'logs', 'transcript.jsonl'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
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
        const parameters = toolInfo?.parameters ?? {};
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
   */
  async fetchHistory(
    sessionId: string,
    options: FetchHistoryOptions = {},
  ): Promise<FetchHistoryResult> {
    const { limit = null, offset = 0 } = options;
    const transcriptPath = findTranscriptPath(sessionId);

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
                const args = tc?.args ?? {};
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

      return {
        messages: page,
        total,
        hasMore,
        offset,
        limit,
      };
    } catch (error) {
      console.warn(`[AntigravitySessions] Failed to load history for ${sessionId}:`, error);
      return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
    }
  }
}
