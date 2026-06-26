import path from 'node:path';
import os from 'node:os';

import { projectsDb, sessionsDb } from '@/modules/database/index.js';
import { generateDisplayName } from '@/modules/projects/index.js';
import { ChatSessionWriter } from '@/modules/websocket/services/chat-session-writer.service.js';
import { connectedClients, WS_OPEN_STATE } from '@/modules/websocket/services/websocket-state.service.js';
import type {
  LLMProvider,
  NormalizedMessage,
  RealtimeClientConnection,
} from '@/shared/types.js';

type ChatRunStatus = 'running' | 'completed';

/**
 * One live (or recently finished) provider run for a single app session.
 *
 * State notes — why each mutable field is essential:
 * - `providerSessionId`: the provider-native id captured mid-run. The abort
 *   handler needs it to address the provider runtime, and the DB mapping is
 *   written from it so history/resume work after the run.
 * - `status`: drives `chat_subscribed.isProcessing`, prevents double sends
 *   into the same session, and guards the synthetic-complete fallback in the
 *   chat handler (only emitted when a runtime died without completing).
 * - `lastSeq` / `events`: the per-run event log. Every live event gets a
 *   monotonically increasing `seq` and is buffered so a reconnecting client
 *   can replay exactly the events it missed via `chat.subscribe`.
 */
type ChatRun = {
  appSessionId: string;
  provider: LLMProvider;
  providerSessionId: string | null;
  status: ChatRunStatus;
  lastSeq: number;
  events: NormalizedMessage[];
  writer: ChatSessionWriter;
  startedAt: number;
  completedAt: number | null;
  /** First user message for auto-title generation on completion. */
  userMessage: string | null;
};

/**
 * How long a completed run stays available for replay. Covers the window
 * between a run finishing and the client refreshing history over REST (for
 * example when the browser tab was asleep while the run completed).
 */
const COMPLETED_RUN_RETENTION_MS = 5 * 60 * 1000;

/**
 * Upper bound on buffered events per run so a very long tool-heavy run cannot
 * grow memory unbounded. When exceeded, the oldest events are dropped —
 * a reconnecting client whose `lastSeq` predates the buffer falls back to a
 * REST history refresh, which is always the authoritative source.
 */
const MAX_BUFFERED_EVENTS_PER_RUN = 5000;

/**
 * Active and recently-completed runs keyed by app session id.
 *
 * This map is the single in-memory source of truth for "is something running
 * for this session" — the chat websocket handler, abort path, and subscribe
 * path all consult it instead of asking each provider runtime individually.
 */
const runs = new Map<string, ChatRun>();

const MAX_TITLE_LENGTH = 60;
const AI_TITLE_TIMEOUT_MS = 5000;

/**
 * Resolve Anthropic API key using the same priority as Claude Code CLI:
 * process.env → ~/.claude/settings.json env → ~/.claude/.credentials.json oauth.
 */
async function resolveAnthropicKey(): Promise<string | null> {
  if (process.env.ANTHROPIC_API_KEY?.trim()) return process.env.ANTHROPIC_API_KEY.trim();
  if (process.env.ANTHROPIC_AUTH_TOKEN?.trim()) return process.env.ANTHROPIC_AUTH_TOKEN.trim();

  // Read from ~/.claude/settings.json env block
  try {
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    const content = await import('node:fs/promises').then(m => m.readFile(settingsPath, 'utf8'));
    const settings: any = JSON.parse(content);
    const env = settings?.env;
    if (typeof env === 'object' && env) {
      if (typeof env.ANTHROPIC_API_KEY === 'string' && env.ANTHROPIC_API_KEY.trim()) return env.ANTHROPIC_API_KEY.trim();
      if (typeof env.ANTHROPIC_AUTH_TOKEN === 'string' && env.ANTHROPIC_AUTH_TOKEN.trim()) return env.ANTHROPIC_AUTH_TOKEN.trim();
    }
  } catch { /* no settings.json */ }

  // Read OAuth access token from ~/.claude/.credentials.json
  try {
    const credPath = path.join(os.homedir(), '.claude', '.credentials.json');
    const content = await import('node:fs/promises').then(m => m.readFile(credPath, 'utf8'));
    const creds: any = JSON.parse(content);
    const oauth = creds?.claudeAiOauth;
    if (oauth && typeof oauth.accessToken === 'string') {
      const expiresAt = typeof oauth.expiresAt === 'number' ? oauth.expiresAt : null;
      if (!expiresAt || Date.now() < expiresAt) {
        return oauth.accessToken;
      }
    }
  } catch { /* no credentials.json */ }

  return null;
}

/**
 * Try to get a title from Anthropic haiku. Returns null on any failure.
 */
async function generateTitleWithAI(userMessage: string): Promise<string | null> {
  const apiKey = await resolveAnthropicKey();
  if (!apiKey) return null;

  const baseUrl = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
  const url = `${baseUrl.replace(/\/+$/, '')}/v1/messages`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TITLE_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-20250915',
        max_tokens: 30,
        messages: [
          {
            role: 'user',
            content: `Generate a short, descriptive title (max 50 chars) for a chat session. Just return the title, nothing else.\n\nUser's first message:\n${userMessage.slice(0, 500)}`,
          },
        ],
      }),
    });

    if (!res.ok) return null;

    const data: any = await res.json();
    const title = data?.content?.[0]?.text?.trim();
    if (typeof title === 'string' && title.length > 0 && title.length <= MAX_TITLE_LENGTH) {
      return title;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Auto-generate a session title from the first user message and persist it.
 * Only runs once per session — if a custom name already exists, this is a no-op.
 *
 * Strategy: call Anthropic haiku with a title-generation prompt (5s timeout).
 * If AI fails, logs a warning and leaves the session untitled — better than
 * a truncated ugly fallback.
 */
async function autoTitleSession(appSessionId: string, userMessage: string | null): Promise<void> {
  if (!userMessage) return;

  const session = sessionsDb.getSessionById(appSessionId);
  if (!session) return;

  // Skip if the session already has a custom name (user set it manually or it was auto-set)
  if (session.custom_name) return;

  let title: string | null = null;
  try {
    title = await generateTitleWithAI(userMessage);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[AutoTitle] AI generation failed', { appSessionId, error: msg });
  }

  if (!title) return;

  try {
    sessionsDb.updateSessionCustomName(appSessionId, title);
    console.debug(`[AutoTitle] Session ${appSessionId}: "${title}"`);
    // Broadcast so the sidebar updates with the new title
    await broadcastCanonicalSessionUpsert(appSessionId);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[AutoTitle] Failed to set title', { appSessionId, error: msg });
  }
}

async function broadcastCanonicalSessionUpsert(appSessionId: string): Promise<void> {
  const row = sessionsDb.getSessionById(appSessionId);
  if (!row || row.isArchived) {
    return;
  }

  const projectPath = row.project_path;
  const project = projectPath ? projectsDb.getProjectPath(projectPath) : null;
  const displayName = project?.custom_project_name?.trim()
    ? project.custom_project_name
    : await generateDisplayName(path.basename(projectPath ?? '') || (projectPath ?? ''), projectPath);

  const payload = JSON.stringify({
    kind: 'session_upserted',
    sessionId: row.session_id,
    providerSessionId: row.provider_session_id,
    provider: row.provider,
    session: {
      id: row.session_id,
      summary: row.custom_name || '',
      messageCount: 0,
      lastActivity: row.updated_at ?? row.created_at ?? new Date().toISOString(),
    },
    project: project
      ? {
        projectId: project.project_id,
        path: project.project_path,
        fullPath: project.project_path,
        displayName,
        isStarred: Boolean(project.isStarred),
      }
      : null,
    timestamp: new Date().toISOString(),
  });

  connectedClients.forEach((client) => {
    if (client.readyState === WS_OPEN_STATE) {
      client.send(payload);
    }
  });
}

function evictRunLater(appSessionId: string): void {
  const timer = setTimeout(() => {
    const run = runs.get(appSessionId);
    if (run && run.status === 'completed') {
      runs.delete(appSessionId);
    }
  }, COMPLETED_RUN_RETENTION_MS);

  // Never keep the process alive just to evict a buffered run.
  timer.unref?.();
}

/**
 * Decorates one outbound live event for a run and records it in the event log.
 *
 * Responsibilities:
 * 1. Remap `sessionId` (and `actualSessionId` on `complete`) to the stable
 *    app session id — provider-native ids never leave the backend.
 * 2. Assign the next `seq` so clients can detect/replay gaps.
 * 3. Buffer the event for `chat.subscribe` replay.
 * 4. Flip the run to `completed` when the terminal `complete` event passes by.
 */
function decorateAndRecordEvent(run: ChatRun, message: NormalizedMessage): NormalizedMessage | null {
  // Exactly-one-complete contract: when a run is aborted the chat handler
  // emits the terminal `complete` immediately, but the killed runtime may
  // still emit its own `complete` from its exit handler moments later.
  // Whichever arrives first wins; the duplicate is dropped here.
  if (message.kind === 'complete' && run.status === 'completed') {
    return null;
  }

  run.lastSeq += 1;

  const outbound: NormalizedMessage = {
    ...message,
    sessionId: run.appSessionId,
    seq: run.lastSeq,
  };

  if (message.kind === 'complete') {
    outbound.actualSessionId = run.appSessionId;
    run.status = 'completed';
    run.completedAt = Date.now();
    evictRunLater(run.appSessionId);

    // Auto-generate session title from the first user message if none exists.
    void autoTitleSession(run.appSessionId, run.userMessage).catch((error) => {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[ChatRunRegistry] Auto-title failed', { appSessionId: run.appSessionId, error: msg });
    });
  }

  run.events.push(outbound);
  if (run.events.length > MAX_BUFFERED_EVENTS_PER_RUN) {
    run.events.splice(0, run.events.length - MAX_BUFFERED_EVENTS_PER_RUN);
  }

  return outbound;
}

/**
 * Records the provider-native session id for a run and persists the
 * app-id-to-provider-id mapping so history fetches and future resumes can
 * address the provider transcript.
 *
 * Called from the gateway writer when the runtime either calls
 * `setSessionId(...)` or emits its `session_created` event — whichever
 * happens first wins; later calls with the same id are no-ops.
 */
function recordProviderSessionId(run: ChatRun, providerSessionId: string): void {
  if (!providerSessionId || run.providerSessionId === providerSessionId) {
    return;
  }

  run.providerSessionId = providerSessionId;

  try {
    sessionsDb.assignProviderSessionId(run.appSessionId, providerSessionId);
    void broadcastCanonicalSessionUpsert(run.appSessionId).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[ChatRunRegistry] Failed to broadcast canonical session mapping', {
        appSessionId: run.appSessionId,
        providerSessionId,
        error: message,
      });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[ChatRunRegistry] Failed to persist provider session id mapping', {
      appSessionId: run.appSessionId,
      providerSessionId,
      error: message,
    });
  }
}

/**
 * Registry of live provider runs keyed by the stable app session id.
 *
 * The registry is what makes the websocket protocol provider-independent:
 * every run gets a `ChatSessionWriter` that remaps provider-native session
 * ids to the app id, assigns `seq` numbers, and buffers events for replay —
 * regardless of which provider runtime produced them.
 */
export const chatRunRegistry = {
  /**
   * Starts tracking a run and returns it, or `null` when a run is already in
   * progress for the session (callers must reject the duplicate send).
   */
  startRun(input: {
    appSessionId: string;
    provider: LLMProvider;
    providerSessionId: string | null;
    connection: RealtimeClientConnection;
    userId: string | number | null;
    userMessage?: string;
  }): ChatRun | null {
    const existing = runs.get(input.appSessionId);
    if (existing && existing.status === 'running') {
      return null;
    }

    const run: ChatRun = {
      appSessionId: input.appSessionId,
      provider: input.provider,
      providerSessionId: input.providerSessionId,
      status: 'running',
      lastSeq: 0,
      events: [],
      writer: null as unknown as ChatSessionWriter,
      startedAt: Date.now(),
      completedAt: null,
      userMessage: input.userMessage || null,
    };

    run.writer = new ChatSessionWriter({
      connection: input.connection,
      userId: input.userId,
      provider: input.provider,
      providerSessionId: input.providerSessionId,
      onProviderSessionId: (providerSessionId) => {
        recordProviderSessionId(run, providerSessionId);
      },
      decorateOutboundEvent: (message) => decorateAndRecordEvent(run, message),
    });

    runs.set(input.appSessionId, run);
    return run;
  },

  getRun(appSessionId: string): ChatRun | undefined {
    return runs.get(appSessionId);
  },

  isProcessing(appSessionId: string): boolean {
    return runs.get(appSessionId)?.status === 'running';
  },

  listRunningRuns(): Array<{
    sessionId: string;
    provider: LLMProvider;
    startedAt: number;
    lastSeq: number;
  }> {
    return Array.from(runs.values())
      .filter((run) => run.status === 'running')
      .map((run) => ({
        sessionId: run.appSessionId,
        provider: run.provider,
        startedAt: run.startedAt,
        lastSeq: run.lastSeq,
      }));
  },

  /**
   * Re-attaches a run's outbound stream to a (new) websocket connection.
   *
   * This is the generic replacement for the Claude-only writer reconnect:
   * after a page refresh the new socket subscribes and immediately starts
   * receiving the still-running stream, for every provider.
   */
  attachConnection(appSessionId: string, connection: RealtimeClientConnection): boolean {
    const run = runs.get(appSessionId);
    if (!run) {
      return false;
    }

    run.writer.updateWebSocket(connection);
    return true;
  },

  /**
   * Returns buffered events with `seq` greater than `afterSeq` for replay.
   *
   * An empty array with `run.lastSeq > afterSeq` not covered by the buffer
   * means the buffer was truncated; the client should refresh over REST.
   */
  replayEvents(appSessionId: string, afterSeq: number): NormalizedMessage[] {
    const run = runs.get(appSessionId);
    if (!run) {
      return [];
    }

    return run.events.filter((event) => typeof event.seq === 'number' && event.seq > afterSeq);
  },

  /**
   * Emits a synthetic terminal `complete` if (and only if) the run is still
   * marked running. Used when a provider runtime throws or resolves without
   * having produced its own terminal event, and by the abort path.
   */
  completeRun(appSessionId: string, opts: { exitCode: number; aborted?: boolean }): void {
    const run = runs.get(appSessionId);
    if (!run || run.status !== 'running') {
      return;
    }

    run.writer.sendComplete(opts);
  },

  /**
   * Test-only escape hatch: clears every tracked run.
   */
  clearAll(): void {
    runs.clear();
  },
};
