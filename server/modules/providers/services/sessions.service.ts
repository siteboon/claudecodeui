import { randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { projectsDb, sessionsDb } from '@/modules/database/index.js';
import { broadcastSessionUpserted, chatRunRegistry } from '@/modules/websocket/index.js';
import { providerRegistry } from '@/modules/providers/provider.registry.js';
import { listBusyClaudeCliSessions } from '@/modules/providers/services/claude-cli-liveness.service.js';
import { sessionHistoryCache } from '@/modules/providers/services/session-history-cache.service.js';
import type {
  BackgroundTaskSummary,
  FetchHistoryOptions,
  FetchHistoryResult,
  LLMProvider,
  NormalizedMessage,
  SessionTranscriptRelocation,
  WorkflowAgentActivity,
} from '@/shared/types.js';
import { AppError, normalizeProjectPath, sliceTailPage } from '@/shared/utils.js';

/**
 * One session the running-sessions poll reports as busy.
 *
 * A chat run in progress is listed as before. A session whose turn has ended
 * but whose background tasks are still outstanding is listed with
 * `background: true` and `canInterrupt: false`: the composer stays usable
 * (the runtime accepts a new turn while the work runs) and there is no run to
 * abort — a task is stopped by id through `chat.stop-task` instead. `tasks`
 * rides along on both kinds whenever the session has any.
 *
 * A turn driven outside CloudCLI — the Claude CLI in the Shell view, or a
 * terminal the user opened themselves — is listed the same way, with
 * `canInterrupt: false` because there is no run here to abort, and a
 * `statusText` saying where the work is happening.
 */
type RunningSessionEntry = {
  sessionId: string;
  provider: LLMProvider;
  startedAt: number;
  lastSeq: number;
  background?: true;
  canInterrupt?: false;
  statusText?: string;
  tasks?: BackgroundTaskSummary[];
};

type CreateAppSessionResult = {
  sessionId: string;
  provider: LLMProvider;
  projectPath: string;
  sessionName: string;
};

type ArchivedSessionListItem = {
  sessionId: string;
  provider: LLMProvider;
  projectId: string | null;
  projectPath: string | null;
  projectDisplayName: string;
  sessionTitle: string;
  createdAt: string | null;
  updatedAt: string | null;
  lastActivity: string | null;
  isProjectArchived: boolean;
};

type RecentSessionListItem = Pick<
  ArchivedSessionListItem,
  'sessionId' | 'provider' | 'projectId' | 'projectDisplayName' | 'sessionTitle' | 'lastActivity'
>;

type RecentSessionsPage = {
  conversations: RecentSessionListItem[];
  total: number;
  hasMore: boolean;
};

type SessionDetails = {
  /** Canonical app-facing session id (may differ from the looked-up id when a provider-native id was given). */
  sessionId: string;
  provider: LLMProvider;
  summary: string;
  createdAt: string | null;
  updatedAt: string | null;
  lastActivity: string | null;
  isArchived: boolean;
  project: {
    projectId: string;
    path: string;
    fullPath: string;
    displayName: string;
    isStarred: boolean;
    isArchived: boolean;
  } | null;
};

const MAX_CLOUDCLI_SESSION_NAME_WORDS = 4;

function buildCloudCliSessionName(initialMessage: string): string {
  const words = initialMessage.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, MAX_CLOUDCLI_SESSION_NAME_WORDS).join(' ') || 'Untitled Session';
}

/**
 * Removes one file if it exists.
 */
async function removeFileIfExists(filePath: string): Promise<boolean> {
  try {
    await fsp.unlink(filePath);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

/**
 * Archive rows need a stable project label even when the owning project is not
 * part of the active sidebar payload. This lightweight resolver keeps the
 * archive API self-contained while still matching the project's stored display
 * name when one exists.
 */
function resolveProjectDisplayName(
  projectPath: string | null,
  customProjectName: string | null | undefined,
): string {
  const trimmedCustomName = typeof customProjectName === 'string' ? customProjectName.trim() : '';
  if (trimmedCustomName.length > 0) {
    return trimmedCustomName;
  }

  if (!projectPath) {
    return 'Unknown Project';
  }

  return path.basename(projectPath) || projectPath;
}

/**
 * Application service for provider-backed session message operations.
 *
 * Callers pass a provider id and this service resolves the concrete provider
 * class, keeping normalization/history call sites decoupled from implementation
 * file layout.
 */
export const sessionsService = {
  /**
   * Lists provider ids that can load session history and normalize live messages.
   */
  listProviderIds(): LLMProvider[] {
    return providerRegistry.listProviders().map((provider) => provider.id);
  },

  /**
   * Returns app-facing ids for provider runs that are currently processing,
   * plus every session whose background work outlived its turn.
   *
   * This is intentionally status-only: callers that only need sidebar activity
   * indicators should not attach to chat streams or request replayed messages.
   */
  async listRunningSessions(): Promise<RunningSessionEntry[]> {
    const entries: RunningSessionEntry[] = chatRunRegistry.listRunningRuns();
    const runningById = new Map(entries.map((entry) => [entry.sessionId, entry]));

    for (const provider of providerRegistry.listProviders()) {
      for (const { sessionId, tasks } of provider.runtime.listBackgroundWork?.() ?? []) {
        const running = runningById.get(sessionId);
        if (running) {
          running.tasks = tasks;
          continue;
        }
        entries.push({
          sessionId,
          provider: provider.id,
          startedAt: Math.min(...tasks.map((task) => task.startedAt)),
          // The completed run stays in the registry for a while, and a client
          // that subscribes with its lastSeq replays the tail it missed.
          lastSeq: chatRunRegistry.getRun(sessionId)?.lastSeq ?? 0,
          background: true,
          canInterrupt: false,
          tasks,
        });
      }
    }

    // The chat-run registry only knows about turns CloudCLI drives itself, so
    // without this a session working under the Claude CLI — including one
    // CloudCLI spawned for its own Shell view — looks idle. A session already
    // listed above keeps its richer entry.
    for (const live of await listBusyClaudeCliSessions()) {
      const session = sessionsDb.getSessionByProviderSessionId(live.providerSessionId);
      if (!session || runningById.has(session.session_id)) {
        continue;
      }

      entries.push({
        sessionId: session.session_id,
        provider: session.provider as LLMProvider,
        startedAt: live.startedAt,
        lastSeq: chatRunRegistry.getRun(session.session_id)?.lastSeq ?? 0,
        // There is no run here to abort: the turn belongs to a CLI process
        // CloudCLI does not own, so it can be reported but not interrupted.
        canInterrupt: false,
        statusText: 'Running in the Claude CLI',
      });
      runningById.set(session.session_id, entries[entries.length - 1]);
    }

    return entries;
  },

  /**
   * Returns the active conversation feed in true global activity order.
   */
  listRecentSessions(limit: number, offset: number): RecentSessionsPage {
    const page = sessionsDb.getRecentSessionsPage(limit, offset);
    const projectCache = new Map<string, ReturnType<typeof projectsDb.getProjectPath>>();
    const conversations = page.sessions.map((session) => {
      const projectPath = session.project_path?.trim() ? session.project_path : null;
      let project = null;

      if (projectPath) {
        if (!projectCache.has(projectPath)) {
          projectCache.set(projectPath, projectsDb.getProjectPath(projectPath));
        }
        project = projectCache.get(projectPath) ?? null;
      }

      return {
        sessionId: session.session_id,
        provider: session.provider as LLMProvider,
        projectId: project?.project_id ?? null,
        projectDisplayName: resolveProjectDisplayName(projectPath, project?.custom_project_name),
        sessionTitle: session.custom_name?.trim() || session.session_id,
        lastActivity: session.updated_at ?? session.created_at ?? null,
      };
    });

    return {
      conversations,
      total: page.total,
      hasMore: offset + conversations.length < page.total,
    };
  },

  /**
   * Resolves the provider-native session id a runtime needs for resume.
   *
   * Callers hand provider runtimes the stable app session id; the provider
   * CLIs/SDKs only understand their own native id, which lives on the session
   * row. Ids without a row are assumed to be provider-native already (direct
   * API callers that reference sessions the watcher has not indexed yet).
   */
  resolveProviderSessionId(sessionId: string | null | undefined): string | null {
    if (!sessionId) {
      return null;
    }

    const session = sessionsDb.getSessionById(sessionId);
    return session ? session.provider_session_id : sessionId;
  },

  /**
   * Normalizes one provider-native event into frontend session message events.
   */
  normalizeMessage(
    providerName: string,
    raw: unknown,
    sessionId: string | null,
  ): NormalizedMessage[] {
    return providerRegistry.resolveProvider(providerName).sessions.normalizeMessage(raw, sessionId);
  },

  /**
   * Allocates a stable app-facing session id before any provider run happens.
   *
   * This is the entry point of the session gateway: the frontend calls this
   * (via `POST /api/providers/sessions`) when the user starts a brand-new
   * chat, navigates to the returned id immediately, and the id never changes
   * for the lifetime of the conversation. The provider-native id is mapped to
   * this row later, when the provider runtime announces it mid-run. Its title
   * comes directly from the first visible CloudCLI message and is limited to
   * four whole words before any provider-owned storage exists.
   */
  createAppSession(
    provider: LLMProvider,
    projectPath: string,
    initialMessage: string,
  ): CreateAppSessionResult {
    const normalizedProjectPath = projectPath.trim();
    if (!normalizedProjectPath) {
      throw new AppError('projectPath is required.', {
        code: 'PROJECT_PATH_REQUIRED',
        statusCode: 400,
      });
    }

    const sessionId = randomUUID();
    const sessionName = buildCloudCliSessionName(initialMessage);
    sessionsDb.createAppSession(sessionId, provider, normalizedProjectPath, sessionName);

    return {
      sessionId,
      provider,
      projectPath: normalizedProjectPath,
      sessionName,
    };
  },

  /**
   * Branches a session into an independent one containing its conversation up
   * to `upToAnchorId` (the whole thing when omitted).
   *
   * The source is left completely untouched — this is the "try two approaches"
   * action, not a destructive one.
   */
  async forkSessionById(
    sessionId: string,
    options: { upToAnchorId?: string; title?: string } = {},
  ): Promise<CreateAppSessionResult> {
    const source = sessionsDb.getSessionById(sessionId);
    if (!source) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    const provider = source.provider as LLMProvider;
    const fork = providerRegistry.resolveProvider(provider).fork;
    if (!fork) {
      throw new AppError(`Sessions cannot be forked for provider "${provider}".`, {
        code: 'FORK_NOT_SUPPORTED',
        statusCode: 409,
      });
    }

    // A session that has never run has no transcript to copy, so there is
    // nothing a fork of it could resume from.
    if (!source.provider_session_id || !source.jsonl_path) {
      throw new AppError('This session has not produced a transcript yet.', {
        code: 'FORK_SOURCE_NOT_READY',
        statusCode: 409,
      });
    }

    const sessionName = options.title?.trim()
      || `${source.custom_name?.trim() || 'Session'} (fork)`;

    const forked = await fork.forkSession({
      providerSessionId: source.provider_session_id,
      jsonlPath: source.jsonl_path,
      projectPath: source.project_path ?? '',
      upToAnchorId: options.upToAnchorId,
      title: sessionName,
    });

    const forkSessionId = randomUUID();
    sessionsDb.createForkedSession({
      sessionId: forkSessionId,
      provider,
      projectPath: source.project_path ?? '',
      customName: sessionName,
      providerSessionId: forked.providerSessionId,
      jsonlPath: forked.jsonlPath,
      forkedFromSessionId: sessionId,
      // A fork that silently dropped to the catalog default would answer
      // differently from the conversation it was branched from.
      model: source.model,
      effort: source.effort,
    });

    await broadcastSessionUpserted(forkSessionId);

    return {
      sessionId: forkSessionId,
      provider,
      projectPath: source.project_path ?? '',
      sessionName,
    };
  },

  /**
   * Moves the transcripts of a project whose folder was renamed or moved, so
   * each session stays resumable from the new folder.
   *
   * Used by the Projects module when a project is repointed. Each provider's
   * sessions go to its optional `transcriptRelocation` facet; providers without
   * one, and provider ids that are no longer registered, are skipped and keep
   * their artifacts where they are. Returns the sessions whose transcript now
   * lives at the returned `jsonlPath`.
   */
  async relocateProjectTranscripts(input: {
    sessions: Array<SessionTranscriptRelocation & { provider: string }>;
    oldProjectPath: string;
    newProjectPath: string;
  }): Promise<SessionTranscriptRelocation[]> {
    const relocated: SessionTranscriptRelocation[] = [];
    for (const provider of providerRegistry.listProviders()) {
      const sessions = input.sessions
        .filter((session) => session.provider === provider.id)
        .map(({ sessionId, jsonlPath }) => ({ sessionId, jsonlPath }));
      if (!provider.transcriptRelocation || sessions.length === 0) {
        continue;
      }

      relocated.push(...await provider.transcriptRelocation.relocateTranscripts({
        sessions,
        oldProjectPath: input.oldProjectPath,
        newProjectPath: input.newProjectPath,
      }));
    }

    return relocated;
  },

  /**
   * Files a session under another project, so it lists there and its next run
   * works in that project's directory.
   *
   * A session that has run has a transcript recording where it ran; the
   * provider's `transcriptRelocation` facet (the one a relocated project folder
   * uses) moves or rewrites it for the new directory, otherwise the indexer
   * would file it back and the provider would not find it when resuming.
   * Providers without that facet can only move sessions that have not run yet.
   */
  async moveSessionToProject(
    sessionId: string,
    projectId: string,
  ): Promise<{ sessionId: string; projectId: string; projectPath: string; warning?: 'SESSION_MOVE_TRANSCRIPT_PENDING' }> {
    const session = sessionsDb.getSessionById(sessionId);
    if (!session) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    const target = projectsDb.getProjectById(projectId);
    if (!target) {
      throw new AppError(`Project "${projectId}" was not found.`, {
        code: 'PROJECT_NOT_FOUND',
        statusCode: 404,
      });
    }

    if (normalizeProjectPath(session.project_path ?? '') === normalizeProjectPath(target.project_path)) {
      throw new AppError('The session already belongs to this project.', {
        code: 'SESSION_ALREADY_IN_PROJECT',
        statusCode: 409,
      });
    }

    // A live turn keeps writing to the old transcript with the old directory,
    // and so does an idle Claude CLI that still has the session open.
    // shortcut: an idle `codex resume` in a terminal is not detectable here; would need a Codex process registry.
    const running = await this.listRunningSessions();
    const openInClaudeCli = session.provider === 'claude' && session.provider_session_id
      ? (await listBusyClaudeCliSessions({ includeIdle: true }))
        .some((live) => live.providerSessionId === session.provider_session_id)
      : false;
    if (openInClaudeCli || running.some((entry) => entry.sessionId === sessionId)) {
      throw new AppError('Stop the session before moving it to another project.', {
        code: 'SESSION_MOVE_RUNNING',
        statusCode: 409,
      });
    }

    const transcriptRelocation = providerRegistry.resolveProvider(session.provider as LLMProvider)
      .transcriptRelocation;
    // OpenCode keeps no per-session file (`jsonl_path` is NULL) and Cursor
    // files transcripts by a directory hash; neither can be moved here.
    if (session.provider_session_id && (!transcriptRelocation || !session.jsonl_path)) {
      throw new AppError(`Sessions cannot be moved for provider "${session.provider}".`, {
        code: 'SESSION_MOVE_NOT_SUPPORTED',
        statusCode: 409,
      });
    }

    const previousProjectPath = session.project_path;
    // A failed restore is logged, never thrown: the error worth reporting is
    // the one that made the move roll back.
    const restoreRow = (restoreTranscriptPath: boolean) => {
      try {
        sessionsDb.updateSessionProjectPath(sessionId, previousProjectPath);
        // The watcher may have pointed the row at the moved copy meanwhile.
        if (restoreTranscriptPath && session.jsonl_path) {
          sessionsDb.updateSessionTranscriptPath(sessionId, session.jsonl_path);
        }
      } catch (restoreError) {
        console.warn(`[sessions] Could not restore the row of ${sessionId}:`, restoreError);
      }
    };
    // Set when the move took effect but its transcript path could not be saved.
    let warning: 'SESSION_MOVE_TRANSCRIPT_PENDING' | undefined;
    // Row before transcript, as a project relocation does: the watcher may
    // index the moved transcript (whose cwd names the new folder) mid-move.
    sessionsDb.updateSessionProjectPath(sessionId, target.project_path);
    try {
      if (transcriptRelocation && session.jsonl_path) {
        let relocated;
        try {
          relocated = await transcriptRelocation.relocateTranscripts({
            sessions: [{ sessionId, jsonlPath: session.jsonl_path }],
            oldProjectPath: previousProjectPath ?? '',
            newProjectPath: target.project_path,
          });
        } catch (error) {
          // The provider undid its file changes; put the row back to match.
          restoreRow(true);
          throw error;
        }

        if (relocated.length === 0) {
          // Skipped (not where the provider expects it, or a path it cannot
          // encode): nothing moved on disk, so neither may the row.
          restoreRow(false);
          throw new AppError('This session\'s transcript could not be moved to the target project.', {
            code: 'SESSION_MOVE_NOT_SUPPORTED',
            statusCode: 409,
          });
        }
        const movedPath = relocated[0].jsonlPath;
        // Codex rewrites in place, so the row already names the file. Claude
        // moves it to another folder, and the row has to follow.
        if (movedPath !== session.jsonl_path) {
          // A busy database usually clears quickly, and moving the file back is
          // the expensive way out, so the cheap write gets a second try.
          let writeError: unknown = null;
          for (const attempt of [1, 2]) {
            try {
              sessionsDb.updateSessionTranscriptPath(sessionId, movedPath);
              writeError = null;
              break;
            } catch (error) {
              writeError = error;
              console.warn(`[sessions] Could not save the moved transcript path of ${sessionId} (attempt ${attempt}):`, error);
              if (attempt === 1) await new Promise((resolve) => setTimeout(resolve, 100));
            }
          }
          if (writeError) {
            // The file has moved but the row cannot say so: move it back to
            // where the old row points, then restore the row.
            // shortcut: the move-back swaps target -> old, so a row that already named the target before the move is changed too; keep the original bytes if that ever matters.
            let movedBack = false;
            try {
              movedBack = (await transcriptRelocation.relocateTranscripts({
                sessions: relocated,
                oldProjectPath: target.project_path,
                newProjectPath: previousProjectPath ?? '',
              })).length > 0;
            } catch (rollbackError) {
              console.warn(`[sessions] Could not move the transcript of ${sessionId} back:`, rollbackError);
            }
            if (movedBack) {
              restoreRow(true);
              throw new AppError('The session could not be moved; it stays in its project.', {
                code: 'SESSION_MOVE_FAILED',
                statusCode: 500,
              });
            }
            // The session is in the target project, where its file now is, so
            // the caller must treat it as moved (refresh, follow the open chat).
            // The watcher repoints jsonl_path once it indexes the moved file.
            console.warn(
              `[sessions] Session ${sessionId} is in ${target.project_path} but its row still names ${session.jsonl_path}; the transcript is at ${movedPath}.`,
            );
            // A code, not a sentence: the client shows it in the user's language.
            warning = 'SESSION_MOVE_TRANSCRIPT_PENDING';
          }
        }
      }
    } finally {
      // On every exit: the watcher may already have broadcast the moved copy,
      // so clients must hear where the session ended up, moved or rolled back.
      sessionHistoryCache.invalidate(sessionId);
      await broadcastSessionUpserted(sessionId).catch((broadcastError) => {
        console.warn(`[sessions] Could not broadcast session ${sessionId}:`, broadcastError);
      });
    }

    return { sessionId, projectId: target.project_id, projectPath: target.project_path, ...(warning ? { warning } : {}) };
  },

  /**
   * Resolves the provider-native id only for an explicit user copy action.
   * Normal session payloads continue to expose only the stable app id.
   */
  getProviderSessionId(sessionId: string): string {
    const session = sessionsDb.getSessionById(sessionId);
    if (!session) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    if (!session.provider_session_id) {
      throw new AppError('This session ID is not available yet.', {
        code: 'PROVIDER_SESSION_ID_NOT_AVAILABLE',
        statusCode: 409,
      });
    }

    return session.provider_session_id;
  },

  /**
   * Fetches persisted history by app session id.
   *
   * Provider and provider-specific lookup hints are resolved from the indexed
   * session metadata in the database. The provider adapter receives the
   * provider-native session id (the one written into transcripts on disk),
   * and every returned message is remapped back to the app session id so
   * provider ids never reach the frontend.
   */
  /**
   * Resolves where a conversation must resume from so that one already-sent
   * message, and everything after it, is replaced.
   *
   * Returns `null` when the provider cannot do this at all, which is how the
   * chat gateway knows to refuse the request rather than silently sending the
   * edit as a new message at the end of the conversation.
   */
  async resolveEditAnchor(
    sessionId: string,
    anchorId: string,
  ): Promise<{ found: boolean; resumeThroughId: string | null } | null> {
    const session = sessionsDb.getSessionById(sessionId);
    if (!session) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    const sessions = providerRegistry.resolveProvider(session.provider as LLMProvider).sessions;
    if (!sessions.resolveEditAnchor) {
      return null;
    }

    return sessions.resolveEditAnchor(sessionId, anchorId);
  },

  /**
   * Whether editing a message on this session's provider means rewinding it on
   * disk first, rather than handing the anchor to the runtime as a resume
   * option.
   *
   * Answering this without doing anything is the point: the rewind moves the
   * session onto a different provider transcript and cannot be undone, so the
   * gateway has to know which shape the run takes before it commits to one.
   */
  providerRewindsForEdit(sessionId: string): boolean {
    const session = sessionsDb.getSessionById(sessionId);
    if (!session) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    return Boolean(providerRegistry.resolveProvider(session.provider as LLMProvider).sessions.rewindSession);
  },

  /**
   * Rewinds a session on disk so `keepThroughId` is the last row it holds.
   *
   * Only call this once the run is admitted — see `providerRewindsForEdit`.
   */
  async rewindSessionForEdit(sessionId: string, keepThroughId: string | null): Promise<void> {
    const session = sessionsDb.getSessionById(sessionId);
    if (!session) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    const sessions = providerRegistry.resolveProvider(session.provider as LLMProvider).sessions;
    await sessions.rewindSession?.(sessionId, keepThroughId);
  },

  async fetchHistory(
    sessionId: string,
    options: Pick<FetchHistoryOptions, 'limit' | 'offset'> = {},
  ): Promise<FetchHistoryResult> {
    const session = sessionsDb.getSessionById(sessionId);
    if (!session) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    // App-created sessions that never produced a provider transcript yet
    // (e.g. first message still streaming) simply have no history.
    if (!session.provider_session_id) {
      return {
        messages: [],
        total: 0,
        hasMore: false,
        offset: options.offset ?? 0,
        limit: options.limit ?? null,
      };
    }

    const provider = session.provider as LLMProvider;
    const providerSessions = providerRegistry.resolveProvider(provider).sessions;
    const providerSessionId = session.provider_session_id;
    const projectPath = session.project_path ?? '';
    const requestedLimit = options.limit ?? null;
    const requestedOffset = options.offset ?? 0;

    // Claude and Codex history readers parse `jsonl_path` itself, so a page
    // can be sliced from the stat-validated full-transcript cache instead of
    // re-parsing the whole file per request. Cursor and OpenCode read their
    // messages from elsewhere (store.db / shared SQLite), so that file's stat
    // says nothing about their history — they stay on the direct path.
    const transcriptPath = provider === 'claude' || provider === 'codex'
      ? session.jsonl_path
      : null;
    const fullHistory = await sessionHistoryCache.getFullHistory({
      sessionId,
      transcriptPath,
      loadFull: () => providerSessions.fetchHistory(sessionId, {
        limit: null,
        offset: 0,
        projectPath,
        providerSessionId,
      }),
    });

    let result: FetchHistoryResult;
    if (fullHistory) {
      // Providers slice with this same helper, so a cached page is identical
      // to what a direct `(limit, offset)` read would have returned.
      const { page, hasMore } = sliceTailPage(fullHistory.messages, requestedLimit, Math.max(0, requestedOffset));
      result = {
        ...fullHistory,
        messages: page,
        hasMore,
        offset: requestedOffset,
        limit: requestedLimit,
      };
    } else {
      result = await providerSessions.fetchHistory(sessionId, {
        limit: requestedLimit,
        offset: requestedOffset,
        projectPath,
        providerSessionId,
      });
    }

    return {
      ...result,
      messages: result.messages.map((message) => ({
        ...message,
        sessionId,
      })),
    };
  },

  /**
   * Reads what one agent of a workflow run did, for the card that opened it.
   *
   * Not found covers both a provider that spawns no workflow agents and a run
   * that left no transcript for this agent: either way there is nothing to
   * show, and the card says so in one line.
   */
  async readWorkflowAgentActivity(sessionId: string, runId: string, agentId: string): Promise<WorkflowAgentActivity> {
    const session = sessionsDb.getSessionById(sessionId);
    if (!session) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    const sessions = providerRegistry.resolveProvider(session.provider as LLMProvider).sessions;
    const activity = await sessions.readWorkflowAgentActivity?.(sessionId, runId, agentId);
    if (!activity) {
      throw new AppError(`Workflow agent "${agentId}" was not found.`, {
        code: 'WORKFLOW_AGENT_NOT_FOUND',
        statusCode: 404,
      });
    }

    return activity;
  },

  /**
   * Resolves one session (by app id, falling back to the provider-native id)
   * to its metadata plus the owning project.
   *
   * This backs deep links like `/session/:sessionId`: the frontend's paginated
   * project payloads only carry each project's first session page, so a
   * session opened directly by URL may not be present client-side at all —
   * this lookup is the authoritative way to learn which project owns it.
   */
  getSessionDetailsById(sessionId: string): SessionDetails {
    const session =
      sessionsDb.getSessionById(sessionId) ?? sessionsDb.getSessionByProviderSessionId(sessionId);
    if (!session) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    const projectPath = session.project_path?.trim() ? session.project_path : null;
    const project = projectPath ? projectsDb.getProjectPath(projectPath) : null;

    return {
      sessionId: session.session_id,
      provider: session.provider as LLMProvider,
      summary: session.custom_name?.trim() || '',
      createdAt: session.created_at ?? null,
      updatedAt: session.updated_at ?? null,
      lastActivity: session.updated_at ?? session.created_at ?? null,
      isArchived: Boolean(session.isArchived),
      project: project && projectPath
        ? {
            projectId: project.project_id,
            path: projectPath,
            fullPath: projectPath,
            displayName: resolveProjectDisplayName(projectPath, project.custom_project_name),
            isStarred: Boolean(project.isStarred),
            isArchived: Boolean(project.isArchived),
          }
        : null,
    };
  },

  /**
   * Returns archived sessions with enough project metadata for the sidebar to
   * group, filter, open, and restore them without a per-row follow-up query.
   */
  listArchivedSessions(): ArchivedSessionListItem[] {
    const archivedSessions = sessionsDb.getArchivedSessions();
    const projectCache = new Map<string, ReturnType<typeof projectsDb.getProjectPath>>();

    return archivedSessions.map((session) => {
      const projectPath = session.project_path?.trim() ? session.project_path : null;
      let project = null;

      if (projectPath) {
        if (!projectCache.has(projectPath)) {
          projectCache.set(projectPath, projectsDb.getProjectPath(projectPath));
        }
        project = projectCache.get(projectPath) ?? null;
      }

      return {
        sessionId: session.session_id,
        provider: session.provider as LLMProvider,
        projectId: project?.project_id ?? null,
        projectPath,
        projectDisplayName: resolveProjectDisplayName(projectPath, project?.custom_project_name),
        sessionTitle: session.custom_name?.trim() || session.session_id,
        createdAt: session.created_at ?? null,
        updatedAt: session.updated_at ?? null,
        lastActivity: session.updated_at ?? session.created_at ?? null,
        isProjectArchived: Boolean(project?.isArchived),
      };
    });
  },

  /**
   * Archives or permanently deletes one persisted session row by id.
   *
   * Soft-delete mirrors the project behavior by toggling `isArchived` so the
   * row disappears from active lists but remains restorable. Force-delete
   * optionally removes the transcript file before deleting the database row.
   */
  async deleteOrArchiveSessionById(
    sessionId: string,
    options: {
      force?: boolean;
      deletedFromDisk?: boolean;
    } = {},
  ): Promise<{ sessionId: string; action: 'archived' | 'deleted'; deletedFromDisk: boolean }> {
    const session = sessionsDb.getSessionById(sessionId);
    if (!session) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    if (!options.force) {
      sessionsDb.updateSessionIsArchived(sessionId, true);
      return {
        sessionId,
        action: 'archived',
        deletedFromDisk: false,
      };
    }

    let removedFromDisk = false;
    if (options.deletedFromDisk) {
      // Every file the conversation has lived in, not just the one the row
      // points at now: editing a message on a provider that rewinds by
      // branching moves the session onto a copy and leaves the earlier
      // transcript behind. Deleting only the current one would leave the
      // replaced turns on disk, and unreachable through the app.
      const transcripts = [
        ...(session.jsonl_path ? [session.jsonl_path] : []),
        ...sessionsDb.getSupersededTranscriptPaths(sessionId),
      ];
      for (const transcript of transcripts) {
        removedFromDisk = (await removeFileIfExists(transcript)) || removedFromDisk;
      }
    }

    sessionsDb.clearSupersededProviderSessions(sessionId);
    const deleted = sessionsDb.deleteSessionById(sessionId);
    if (!deleted) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    return {
      sessionId,
      action: 'deleted',
      deletedFromDisk: removedFromDisk,
    };
  },

  /**
   * Restores one archived session back into the active sidebar lists.
   */
  restoreSessionById(sessionId: string): { sessionId: string; isArchived: false } {
    const session = sessionsDb.getSessionById(sessionId);
    if (!session) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    sessionsDb.updateSessionIsArchived(sessionId, false);
    return { sessionId, isArchived: false };
  },

  /**
   * Renames one session by id without requiring the caller to pass provider.
   */
  renameSessionById(sessionId: string, summary: string): { sessionId: string; summary: string } {
    const session = sessionsDb.getSessionById(sessionId);
    if (!session) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    sessionsDb.updateSessionCustomName(sessionId, summary);
    return { sessionId, summary };
  },
};
