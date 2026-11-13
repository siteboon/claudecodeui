import os from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

import Database from 'better-sqlite3';

import { sessionsDb } from '@/modules/database/index.js';
import { AntigravityForkProvider } from '@/modules/providers/list/antigravity/antigravity-fork.provider.js';
import type { FetchHistoryOptions, FetchHistoryResult, IProviderSessions, NormalizedMessage } from '@/shared/index.js';
import {
  createNormalizedMessage,
  AppError,
  parseFilesInputTag,
  parseImagesInputTag,
  readProtobufFields,
  generateMessageId,
  readObjectRecord,
  readOptionalString,
  sanitizeLeafDirectoryName,
  sliceTailPage,
  stripAntigravityTags,
} from '@/shared/index.js';

const PROVIDER = 'antigravity';
const WAITING_FOR_EVENTS = /^<WAITING_FOR_EVENTS>\s*<\/WAITING_FOR_EVENTS>$/;
const TRUNCATION_MARKER = /<truncated \d+ bytes>/;

type PendingAntigravityTool = { message: NormalizedMessage; toolName: string };

/** Resolves the native conversation DB without accepting path separators in a session id. */
function resolveAntigravityConversationDbPath(providerSessionId: string | null): string | null {
  if (!providerSessionId) return null;
  const safeSessionId = sanitizeLeafDirectoryName(providerSessionId, 'Antigravity session id');
  return path.join(os.homedir(), '.gemini', 'antigravity-cli', 'conversations', `${safeSessionId}.db`);
}

/** Reads one length-delimited protobuf field without depending on AGY's private schema. */
function readWireField(payload: Buffer, wantedField: number): Buffer | null {
  try {
    const field = readProtobufFields(payload).get(wantedField)?.[0];
    return Buffer.isBuffer(field) ? field : null;
  } catch { return null; }
}

/** Restores a clipped assistant answer from the matching native AGY step, if it is still available. */
function restoreTruncatedAssistantContent(
  content: string,
  stepIndex: number,
  providerSessionId: string | null,
): string | null {
  const marker = TRUNCATION_MARKER.exec(content);
  if (!marker || !providerSessionId || !Number.isSafeInteger(stepIndex) || stepIndex < 0) return null;

  try {
    const dbPath = resolveAntigravityConversationDbPath(providerSessionId);
    if (!dbPath) return null;
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    let payload: unknown;
    try {
      payload = (db.prepare('SELECT step_payload FROM steps WHERE idx = ?').get(stepIndex) as
        | { step_payload?: unknown }
        | undefined)?.step_payload;
    } finally {
      db.close();
    }
    if (!Buffer.isBuffer(payload)) return null;

    // AGY stores planner text at step_payload field 20, nested field 1.
    const plannerStep = readWireField(payload, 20);
    const textField = plannerStep && readWireField(plannerStep, 1);
    if (!textField) return null;
    const fullContent = new TextDecoder('utf-8', { fatal: true }).decode(textField);
    const prefix = content.slice(0, marker.index).trimEnd();
    const suffix = content.slice(marker.index + marker[0].length).trimStart();
    if (!prefix || !suffix || !fullContent.startsWith(prefix) || !fullContent.endsWith(suffix)) return null;
    return fullContent;
  } catch {
    // Older AGY stores may lack the native DB or use a different step layout.
    return null;
  }
}

/** AGY leaves a final quota or runtime error only in the native DB, after the JSONL transcript ends. */
function readTrailingAntigravityError(
  providerSessionId: string | null,
  lastTranscriptStepIndex: number,
): { stepIndex: number; content: string } | null {
  try {
    const dbPath = resolveAntigravityConversationDbPath(providerSessionId);
    if (!dbPath) return null;
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    let row: { idx: number; step_type: number; step_payload: unknown } | undefined;
    try {
      row = db.prepare('SELECT idx, step_type, step_payload FROM steps ORDER BY idx DESC LIMIT 1').get() as
        | { idx: number; step_type: number; step_payload: unknown }
        | undefined;
    } finally {
      db.close();
    }
    if (!row || row.idx <= lastTranscriptStepIndex || row.step_type !== 17 || !Buffer.isBuffer(row.step_payload)) {
      return null;
    }
    // AGY's terminal error summary is step_payload field 24, nested fields 3 then 1.
    const errorStep = readWireField(row.step_payload, 24);
    const errorDetails = errorStep && readWireField(errorStep, 3);
    const summary = errorDetails && readWireField(errorDetails, 1);
    if (!summary) return null;
    const content = new TextDecoder('utf-8', { fatal: true }).decode(summary).trim();
    return content ? { stepIndex: row.idx, content } : null;
  } catch {
    return null;
  }
}

/** Resolves AGY's standard transcript location when an app-created DB row has not been synchronized yet. */
function resolveAntigravityTranscriptPath(options: FetchHistoryOptions): string | null {
  const indexedPath = readOptionalString(options.jsonlPath);
  if (indexedPath) {
    return indexedPath;
  }

  const providerSessionId = readOptionalString(options.providerSessionId);
  if (!providerSessionId) {
    return null;
  }

  const safeSessionId = sanitizeLeafDirectoryName(providerSessionId, 'Antigravity session id');
  return path.join(
    os.homedir(),
    '.gemini',
    'antigravity-cli',
    'brain',
    safeSessionId,
    '.system_generated',
    'logs',
    'transcript.jsonl',
  );
}

/** Converts a provider timestamp into the normalized ISO representation. */
function parseAntigravityTimestamp(value: unknown): string | undefined {
  const raw = readOptionalString(value);
  if (!raw) {
    return undefined;
  }

  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** Maps one AGY JSONL step into zero or more shared history messages. */
function normalizeAntigravityHistoryStep(
  rawStep: unknown, sessionId: string | null, pendingTools: PendingAntigravityTool[],
): NormalizedMessage[] {
  const raw = readObjectRecord(rawStep);
  if (!raw) {
    return [];
  }

  const source = readOptionalString(raw.source);
  const type = readOptionalString(raw.type);
  const content = readOptionalString(raw.content);
  const stepIndex = raw.step_index;
  const baseId = `${sessionId || 'antigravity'}-${typeof stepIndex === 'number' ? stepIndex : generateMessageId('antigravity')}`;
  const timestamp = parseAntigravityTimestamp(raw.created_at);

  if (source === 'USER_EXPLICIT' && type === 'USER_INPUT' && content?.trim()) {
    const parsed = parseFilesInputTag(stripAntigravityTags(content));
    const images = parseImagesInputTag(parsed.text);
    return [createNormalizedMessage({
      id: baseId,
      sessionId,
      timestamp,
      provider: PROVIDER,
      kind: 'text',
      role: 'user',
      content: images.text,
      files: parsed.attachments.length ? parsed.attachments : undefined,
      images: images.attachments.length ? images.attachments : undefined,
      transcriptAnchorId: Number.isSafeInteger(stepIndex) && (stepIndex as number) >= 0 ? String(stepIndex) : undefined,
    })];
  }

  if (source === 'MODEL' && type === 'PLANNER_RESPONSE') {
    const messages: NormalizedMessage[] = [];
    const thinking = readOptionalString(raw.thinking);
    for (const [kind, text] of [['thinking', thinking], ['text', content]] as const) {
      if (!text?.trim() || WAITING_FOR_EVENTS.test(text.trim())) continue;
      messages.push(createNormalizedMessage({
        id: kind === 'thinking' && content ? `${baseId}-thinking` : baseId,
        sessionId, timestamp, provider: PROVIDER, kind, role: 'assistant', content: text.trim(),
      }));
    }
    for (const [index, entry] of (Array.isArray(raw.tool_calls) ? raw.tool_calls : []).entries()) {
      const call = readObjectRecord(entry);
      const toolName = readOptionalString(call?.name);
      if (!toolName) continue;
      const toolId = `${baseId}-tool-${index}`;
      const message = createNormalizedMessage({
        id: toolId, sessionId, timestamp, provider: PROVIDER, kind: 'tool_use', role: 'assistant',
        toolId, toolName, toolInput: call?.args ?? {},
      });
      pendingTools.push({ message, toolName });
      messages.push(message);
    }
    return messages;
  }

  if (source === 'MODEL' && content?.trim()) {
    const pendingTool = pendingTools.shift();
    if (pendingTool) {
      // Live stream tool steps use the result step's index. Once known, give
      // both persisted rows those same identities so refresh can reconcile
      // the streamed cards instead of adding duplicate calls and results.
      pendingTool.message.id = `${baseId}-call`;
      pendingTool.message.toolId = `${baseId}-call`;
    }
    return [createNormalizedMessage({
      id: baseId,
      sessionId,
      timestamp,
      provider: PROVIDER,
      kind: 'tool_result',
      role: 'assistant',
      toolName: pendingTool?.toolName ?? type ?? 'Antigravity Tool',
      toolId: pendingTool?.message.toolId ?? baseId,
      content: content.trim(),
      isError: type === 'ERROR_MESSAGE',
    })];
  }

  if (source === 'SYSTEM' && type === 'ERROR_MESSAGE' && content?.trim()) {
    return [createNormalizedMessage({
      id: baseId,
      sessionId,
      timestamp,
      provider: PROVIDER,
      kind: 'error',
      content: content.trim(),
    })];
  }

  return [];
}

/** Antigravity transcript reader and message normalizer used by session services. */
export class AntigravitySessionsProvider implements IProviderSessions {
  /** The common edit gateway addresses stable native step indices, never visible row ordinals. */
  async resolveEditAnchor(sessionId: string, anchorId: string) {
    const session = sessionsDb.getSessionById(sessionId);
    if (!session?.jsonl_path || !session.provider_session_id) return { found: false, resumeThroughId: null };
    const lines = (await readFile(session.jsonl_path, 'utf8')).split(/\r?\n/);
    let previous: string | null = null;
    let lastIndex = -1;
    for (const line of lines) {
      if (!line.trim()) continue;
      let step;
      try { step = readObjectRecord(JSON.parse(line)); } catch { return { found: false, resumeThroughId: null }; }
      if (!Number.isSafeInteger(step?.step_index) || (step!.step_index as number) <= lastIndex) {
        return { found: false, resumeThroughId: null };
      }
      lastIndex = step!.step_index as number;
      if (String(lastIndex) === anchorId) return {
        found: step?.source === 'USER_EXPLICIT' && step.type === 'USER_INPUT', resumeThroughId: previous,
      };
      previous = String(lastIndex);
    }
    return { found: false, resumeThroughId: null };
  }

  /** Branches the retained native prefix and retires the original mapping after snapshot success. */
  async rewindSession(sessionId: string, keepThroughId: string | null): Promise<void> {
    const session = sessionsDb.getSessionById(sessionId);
    if (!session?.provider_session_id || !session.jsonl_path) throw new AppError('The Antigravity transcript is not ready.', {
      code: 'EDIT_SOURCE_NOT_READY', statusCode: 409,
    });
    const fork = keepThroughId === null ? null : await new AntigravityForkProvider().forkSession({
      providerSessionId: session.provider_session_id, jsonlPath: session.jsonl_path,
      projectPath: session.project_path ?? process.cwd(), upToAnchorId: keepThroughId,
    });
    sessionsDb.markProviderSessionSuperseded({
      provider: PROVIDER, providerSessionId: session.provider_session_id, sessionId, jsonlPath: session.jsonl_path,
    });
    if (fork) sessionsDb.repointSessionToProviderSession(sessionId, fork);
    else sessionsDb.detachProviderSession(sessionId);
  }

  /** Normalizes a live AGY output chunk for websocket and SSE consumers. */
  normalizeMessage(rawMessage: unknown, sessionId: string | null): NormalizedMessage[] {
    const raw = readObjectRecord(rawMessage);
    const content = typeof rawMessage === 'string'
      ? rawMessage
      : readOptionalString(raw?.content) ?? readOptionalString(raw?.text) ?? '';

    if (!content.trim()) {
      return [];
    }

    return [createNormalizedMessage({
      id: readOptionalString(raw?.id) ?? generateMessageId('antigravity'),
      sessionId,
      provider: PROVIDER,
      kind: 'stream_delta',
      content,
    })];
  }

  /** Loads a resilient, tail-paginated view of an AGY transcript. */
  async fetchHistory(
    sessionId: string,
    options: FetchHistoryOptions = {},
  ): Promise<FetchHistoryResult> {
    const { limit = null, offset = 0 } = options;
    const normalizedOffset = Math.max(0, offset);
    const normalizedLimit = limit === null ? null : Math.max(0, limit);
    const transcriptPath = resolveAntigravityTranscriptPath(options);
    if (!transcriptPath) {
      return {
        messages: [],
        total: 0,
        hasMore: false,
        offset: normalizedOffset,
        limit: normalizedLimit,
      };
    }

    const normalized: NormalizedMessage[] = [];
    const pendingTools: PendingAntigravityTool[] = [];
    let lastTranscriptStepIndex = -1;
    try {
      const lines = (await readFile(transcriptPath, 'utf8')).split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }

        try {
          const step = JSON.parse(trimmed);
          const raw = readObjectRecord(step);
          if (typeof raw?.step_index === 'number') {
            lastTranscriptStepIndex = Math.max(lastTranscriptStepIndex, raw.step_index);
          }
          const truncatedFields = raw?.truncated_fields;
          if (
            raw?.source === 'MODEL'
            && raw.type === 'PLANNER_RESPONSE'
            && Array.isArray(truncatedFields)
            && truncatedFields.includes('content')
            && typeof raw.content === 'string'
            && typeof raw.step_index === 'number'
          ) {
            const restored = restoreTruncatedAssistantContent(
              raw.content,
              raw.step_index,
              readOptionalString(options.providerSessionId) ?? null,
            );
            if (restored !== null) raw.content = restored;
          }
          normalized.push(...normalizeAntigravityHistoryStep(raw ?? step, sessionId, pendingTools));
        } catch {
          // A live transcript can end with a partially written JSONL record.
          // Preserve every complete entry instead of hiding the whole history.
        }
      }
    } catch (error) {
      console.warn(
        '[AntigravityProvider] Failed to read session transcript:',
        error instanceof Error ? error.name : 'UnknownError',
      );
      return {
        messages: [],
        total: 0,
        hasMore: false,
        offset: normalizedOffset,
        limit: normalizedLimit,
      };
    }

    const trailingError = readTrailingAntigravityError(
      readOptionalString(options.providerSessionId) ?? null,
      lastTranscriptStepIndex,
    );
    if (trailingError) {
      normalized.push(createNormalizedMessage({
        id: `${sessionId}-${trailingError.stepIndex}`,
        sessionId,
        provider: PROVIDER,
        kind: 'error',
        content: trailingError.content,
      }));
    }

    const { page, hasMore } = sliceTailPage(normalized, normalizedLimit, normalizedOffset);

    return {
      messages: page,
      total: normalized.length,
      hasMore,
      offset: normalizedOffset,
      limit: normalizedLimit,
    };
  }
}
