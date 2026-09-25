import { randomUUID } from 'node:crypto';
import path from 'node:path';

import type { WebSocket } from 'ws';

import { sessionsDb } from '@/modules/database/index.js';
import { providerModelsService, sessionsService } from '@/modules/providers/index.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
import { connectedClients, WS_OPEN_STATE } from '@/modules/websocket/services/websocket-state.service.js';
import {
  getGlobalImageAssetsDir,
  isImageAttachmentDescriptor,
  normalizeAttachmentDescriptors,
  type ChatAttachmentDescriptor,
} from '@/shared/image-attachments.js';
import type {
  AnyRecord,
  AuthenticatedWebSocketRequest,
  LLMProvider,
  ProviderPermissionDecision,
  ProviderRuntimeWriter,
} from '@/shared/types.js';
import { createNormalizedMessage, parseIncomingJsonObject } from '@/shared/utils.js';

/**
 * Trust boundary for client-supplied image attachments: chat.send options come
 * straight from the browser, and the provider runtimes read the referenced
 * files off disk (Claude base64-encodes them into the prompt). Only images
 * that live directly inside the global upload store (`~/.cloudcli/assets`,
 * where POST /api/assets/images puts them) are allowed through — anything
 * else (absolute paths elsewhere, traversal, subdirectories) is dropped.
 *
 * Exported for tests; `assetsRootOverride` exists only for them.
 */
export function filterAttachmentsToUploadStore(
  attachments: unknown,
  assetsRootOverride?: string,
): ChatAttachmentDescriptor[] {
  const assetsRoot = path.resolve(assetsRootOverride ?? getGlobalImageAssetsDir());

  return normalizeAttachmentDescriptors(attachments).filter((descriptor) => {
    // Relative paths are anchored in the store; absolute ones must already be in it.
    const resolved = path.resolve(assetsRoot, descriptor.path);
    const relative = path.relative(assetsRoot, resolved);
    const isDirectChild =
      relative.length > 0 &&
      !relative.startsWith('..') &&
      !path.isAbsolute(relative) &&
      !relative.includes(path.sep) &&
      !relative.includes('/');

    if (!isDirectChild) {
      console.warn(`[Chat] Dropping attachment outside the upload store: ${descriptor.path}`);
    }
    return isDirectChild;
  });
}

/** Backward-compatible image filter consumed by existing websocket tests. */
export function filterImagesToUploadStore(
  images: unknown,
  assetsRootOverride?: string,
): ChatAttachmentDescriptor[] {
  return filterAttachmentsToUploadStore(images, assetsRootOverride);
}

/** Application boundary for dispatching provider runs and approvals. */
export type ProviderRuntimeGateway = {
  hasRuntime(provider: string): boolean;
  run(
    provider: LLMProvider,
    command: string,
    options: AnyRecord,
    writer: ProviderRuntimeWriter,
  ): Promise<unknown>;
  abort(provider: LLMProvider, sessionId: string): Promise<boolean>;
  stopBackgroundTask(provider: LLMProvider, sessionId: string, taskId: string): Promise<boolean>;
  /** Whether a provider runtime still holds background work for the session after its turn ended. */
  hasBackgroundWork(sessionId: string): boolean;
  resolveToolApproval(requestId: string, payload: ProviderPermissionDecision): void;
  getPendingApprovalsForSession(sessionId: string): unknown[];
  /** Whether the provider's runtime can deliver a message into an already-running turn. */
  canSteer(provider: string): boolean;
  /**
   * Pushes a message into a running turn's stdin so the CLI folds it in at its
   * next tool boundary, instead of queuing it for a turn of its own. Resolves
   * `null` when the provider cannot steer, or when the live process wound down
   * between the `canSteer` check and this call.
   */
  steer(
    provider: LLMProvider,
    sessionId: string,
    command: string,
    options: AnyRecord,
  ): Promise<{ uuid: string } | null>;
};

type ChatWebSocketDependencies = {
  /** Central dispatcher for every provider SDK/CLI runtime. */
  runtime: ProviderRuntimeGateway;
};

/**
 * Extracts the authenticated request user id in the formats currently produced
 * by platform and OSS auth code paths.
 */
function readRequestUserId(
  request: AuthenticatedWebSocketRequest | undefined
): string | number | null {
  const user = request?.user;
  if (!user) {
    return null;
  }

  if (typeof user.id === 'string' || typeof user.id === 'number') {
    return user.id;
  }

  if (typeof user.userId === 'string' || typeof user.userId === 'number') {
    return user.userId;
  }

  return null;
}

function sendJson(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === WS_OPEN_STATE) {
    ws.send(JSON.stringify(payload));
  }
}

/**
 * The inbound frame type a protocol error is responding to. Carried on
 * `RUN_IN_PROGRESS`/`STEER_UNSUPPORTED` protocol errors so the client can
 * tell a `chat.steer` rejection (silently re-queue the pending steer text)
 * apart from an ordinary `chat.send`/`chat.edit-send` rejection that happens
 * to share the same code (a real failure — must surface as an error row).
 * Used only within this file today; move to `server/shared/types.ts` if a
 * second module needs it.
 */
type ChatRequestType = 'chat.send' | 'chat.steer' | 'chat.edit-send';

/**
 * Reports a protocol-level failure to the requesting client.
 *
 * Protocol errors deliberately use their own `kind` (instead of the provider
 * `error` message kind) so the frontend can distinguish "your request was
 * invalid" from "the model run produced an error" without inspecting text.
 *
 * `requestType`, when given, is the inbound frame type that triggered this
 * error — see `ChatRequestType`. Omitted entirely from the payload when not
 * given, so unrelated protocol errors keep their existing shape.
 */
function sendProtocolError(
  ws: WebSocket,
  code: string,
  error: string,
  sessionId?: string,
  requestType?: ChatRequestType
): void {
  sendJson(ws, {
    kind: 'protocol_error',
    code,
    error,
    sessionId: sessionId ?? null,
    ...(requestType ? { requestType } : {}),
    timestamp: new Date().toISOString(),
  });
}

function readRequiredSessionId(data: AnyRecord): string | null {
  const sessionId = typeof data.sessionId === 'string' ? data.sessionId.trim() : '';
  return sessionId.length > 0 ? sessionId : null;
}

/**
 * Validates client-supplied attachments against the upload store, dedupes
 * them, and splits the result into images and non-image files.
 *
 * Shared by `dispatchRun` (chat.send / chat.edit-send) and `handleChatSteer`,
 * which accept the same `options.images` / `options.files` / `options.attachments`
 * shape and must apply the same trust boundary (see `filterAttachmentsToUploadStore`).
 */
function resolveVerifiedAttachments(clientOptions: AnyRecord): {
  attachments: ChatAttachmentDescriptor[];
  images: ChatAttachmentDescriptor[];
  files: ChatAttachmentDescriptor[];
} {
  const attachmentCandidates = [
    ...normalizeAttachmentDescriptors(clientOptions.images),
    ...normalizeAttachmentDescriptors(clientOptions.files),
    ...normalizeAttachmentDescriptors(clientOptions.attachments),
  ];
  const verifiedAttachments = filterAttachmentsToUploadStore(attachmentCandidates);
  const attachments = verifiedAttachments.filter(
    (descriptor, index, all) => all.findIndex((candidate) => candidate.path === descriptor.path) === index,
  );

  return {
    attachments,
    images: attachments.filter(isImageAttachmentDescriptor),
    files: attachments.filter((descriptor) => !isImageAttachmentDescriptor(descriptor)),
  };
}

/**
 * Aborts a session's running run and emits its terminal `complete` on its
 * behalf, so a caller can immediately start a new run in its place.
 *
 * Shared by `runDetachedChatTurn` (a scheduled message outranks whatever is
 * running) and `chat.send` with `options.interrupt` (the user replaces their
 * own in-flight turn instead of queuing behind it).
 *
 * `options.replaced` marks the emitted `complete { aborted: true }` as one
 * where a replacement run is about to start right after, so a client that
 * reads it should keep the session's processing state instead of treating it
 * as the session going idle. Only the `chat.send` interrupt route passes it —
 * see its call site for why `runDetachedChatTurn`'s does not.
 */
async function abortRunningRun(
  dependencies: ChatWebSocketDependencies,
  provider: LLMProvider,
  sessionId: string,
  options?: { replaced?: boolean },
): Promise<void> {
  const aborted = await dependencies.runtime.abort(provider, sessionId);
  chatRunRegistry.completeRun(sessionId, {
    exitCode: aborted ? 0 : 1,
    aborted: true,
    replaced: options?.replaced,
  });
}

/**
 * Handles `chat.send`: resolves the session row (provider, project path, and
 * provider-native id all come from the database — never from the client),
 * registers the run, and dispatches to the provider runtime.
 *
 * `options.interrupt === true` while a run is already processing aborts that
 * run first instead of refusing with `RUN_IN_PROGRESS` — the user is
 * deliberately replacing their own in-flight turn.
 */
async function handleChatSend(
  ws: WebSocket,
  userId: string | number | null,
  data: AnyRecord,
  dependencies: ChatWebSocketDependencies
): Promise<void> {
  const resolved = resolveSendTarget(ws, data, dependencies, 'chat.send');
  if (!resolved) {
    return;
  }

  const clientOptions = (data.options ?? {}) as AnyRecord;
  if (clientOptions.interrupt === true && chatRunRegistry.isProcessing(resolved.sessionId)) {
    const activeRun = chatRunRegistry.getRun(resolved.sessionId);
    if (activeRun) {
      await abortRunningRun(dependencies, activeRun.provider, resolved.sessionId, { replaced: true });
    }
  }

  await dispatchRun(ws, userId, resolved.sessionId, resolved.session, data, dependencies);
}

/**
 * Handles `chat.steer`: while a turn is running, pushes the message into that
 * turn's stdin so the CLI folds it in at its next tool boundary (the CLI's own
 * "queued message" behaviour) instead of refusing with `RUN_IN_PROGRESS`.
 *
 * A session with nothing running has no turn to fold into, so it behaves
 * exactly like `chat.send`.
 */
/**
 * Delivers a `chat.steer` request when there is no running turn to fold
 * into: dispatches a normal run, but still acks the sender (`chat.steer`
 * expects `chat_steered`, not silence) and echoes the message itself — the
 * composer already cleared its optimistic input on send, relying on the
 * same run-stream echo `chat.steer`'s folding path uses.
 *
 * Used both when `chatRunRegistry.isProcessing` is already false up front,
 * and when `runtime.steer` resolves to `null` because the run finished
 * *during* the steer call (e.g. while awaiting attachment reads) — by the
 * time we find out, the registry agrees nothing is running, so the same
 * fallback applies instead of a client-facing `STEER_UNSUPPORTED`.
 */
function dispatchSteerFallback(
  ws: WebSocket,
  userId: string | number | null,
  sessionId: string,
  session: NonNullable<ReturnType<typeof sessionsDb.getSessionById>>,
  provider: LLMProvider,
  data: AnyRecord,
  dependencies: ChatWebSocketDependencies,
): void {
  const clientOptions = (data.options ?? {}) as AnyRecord;
  const content = typeof data.content === 'string' ? data.content : '';
  const { images, files } = resolveVerifiedAttachments(clientOptions);

  // Not awaited: `runtime.run` only resolves once the whole turn ends, and
  // the sender's `chat_steered` ack (below) must not wait that long. The
  // registry's `startRun` call inside `dispatchRun` runs synchronously
  // before its first `await`, so the run is already registered by the time
  // execution reaches the `sendJson` call beneath it.
  void dispatchRun(ws, userId, sessionId, session, data, dependencies, {}, (run) => {
    run.writer.send(createNormalizedMessage({
      kind: 'text',
      role: 'user',
      content,
      id: `local_steer_${randomUUID()}`,
      images,
      files,
      sessionId,
      provider,
      steered: false,
    }));
  }, 'chat.steer');

  sendJson(ws, {
    kind: 'chat_steered',
    sessionId,
    uuid: null,
    fallback: true,
    timestamp: new Date().toISOString(),
  });
}

async function handleChatSteer(
  ws: WebSocket,
  userId: string | number | null,
  data: AnyRecord,
  dependencies: ChatWebSocketDependencies
): Promise<void> {
  const resolved = resolveSendTarget(ws, data, dependencies, 'chat.steer');
  if (!resolved) {
    return;
  }
  const { sessionId, session, provider } = resolved;

  if (!chatRunRegistry.isProcessing(sessionId)) {
    dispatchSteerFallback(ws, userId, sessionId, session, provider, data, dependencies);
    return;
  }

  if (!dependencies.runtime.canSteer(provider)) {
    sendProtocolError(
      ws,
      'STEER_UNSUPPORTED',
      `Provider "${provider}" cannot deliver a message into a running turn.`,
      sessionId,
      'chat.steer',
    );
    return;
  }

  const clientOptions = (data.options ?? {}) as AnyRecord;
  const content = typeof data.content === 'string' ? data.content : '';
  const { attachments, images, files } = resolveVerifiedAttachments(clientOptions);

  const steerOptions: AnyRecord = {
    ...clientOptions,
    attachments,
    images,
    files,
    cwd: clientOptions.cwd ?? session.project_path ?? undefined,
  };

  const result = await dependencies.runtime.steer(provider, sessionId, content, steerOptions);
  if (!result) {
    if (!chatRunRegistry.isProcessing(sessionId)) {
      // The turn ended while we were awaiting `runtime.steer` (e.g. during
      // its attachment-read step) — the client's `complete` handler already
      // ran and discarded any pending-steer bookkeeping, so a late
      // `STEER_UNSUPPORTED` would land on nothing. Deliver it as a normal
      // run instead, same as the up-front idle path above.
      dispatchSteerFallback(ws, userId, sessionId, session, provider, data, dependencies);
      return;
    }
    // Still processing (e.g. the process is winding down but the registry
    // hasn't caught up yet) — same client-facing outcome as a provider that
    // never supported steering; the client re-queues it.
    sendProtocolError(
      ws,
      'STEER_UNSUPPORTED',
      `Provider "${provider}" cannot deliver a message into a running turn.`,
      sessionId,
      'chat.steer',
    );
    return;
  }

  // Echoed to every socket attached to the run (not just the sender) via the
  // run's writer, the same channel the provider's own turn events flow
  // through — a second tab watching this session sees the steered message too.
  const run = chatRunRegistry.getRun(sessionId);
  run?.writer.send(createNormalizedMessage({
    kind: 'text',
    role: 'user',
    content,
    id: `local_steer_${result.uuid}`,
    images,
    files,
    sessionId,
    provider,
    steered: true,
  }));

  // The ack goes only to the sender — every other attached socket already
  // learned about the steer from the echo above.
  sendJson(ws, {
    kind: 'chat_steered',
    sessionId,
    uuid: result.uuid,
    timestamp: new Date().toISOString(),
  });
}

type ResolvedSendTarget = {
  sessionId: string;
  session: NonNullable<ReturnType<typeof sessionsDb.getSessionById>>;
  provider: LLMProvider;
};

/**
 * Shared front half of `chat.send` and `chat.edit-send`: the session row and
 * provider come from the database, never from the client.
 */
function resolveSendTarget(
  ws: WebSocket,
  data: AnyRecord,
  dependencies: ChatWebSocketDependencies,
  frameName: string,
): ResolvedSendTarget | null {
  const sessionId = readRequiredSessionId(data);
  if (!sessionId) {
    sendProtocolError(ws, 'SESSION_ID_REQUIRED', `${frameName} requires a sessionId.`);
    return null;
  }

  const session = sessionsDb.getSessionById(sessionId);
  if (!session) {
    sendProtocolError(
      ws,
      'SESSION_NOT_FOUND',
      `Session "${sessionId}" was not found. Create it via POST /api/providers/sessions first.`,
      sessionId
    );
    return null;
  }

  const provider = session.provider as LLMProvider;
  if (!dependencies.runtime.hasRuntime(provider)) {
    sendProtocolError(ws, 'UNSUPPORTED_PROVIDER', `Provider "${provider}" is not available.`, sessionId);
    return null;
  }

  return { sessionId, session, provider };
}

/**
 * Registers the run and hands the turn to the provider runtime.
 *
 * `extraRuntimeOptions` is how an edited message asks the provider to resume
 * partway instead of continuing from the tip; a normal send passes nothing.
 *
 * `requestType` names the inbound frame that led here (defaults to
 * `chat.send`, its most common caller) purely so a `RUN_IN_PROGRESS` refusal
 * can tag itself correctly — see `ChatRequestType` and `sendProtocolError`.
 * `dispatchSteerFallback` passes `chat.steer` and `handleChatEditSend` passes
 * `chat.edit-send`; a detached run started by `runDetachedChatTurn` has no
 * `ws` to send the error to, so its requestType never surfaces either way.
 */
async function dispatchRun(
  ws: WebSocket | null,
  userId: string | number | null,
  sessionId: string,
  session: NonNullable<ReturnType<typeof sessionsDb.getSessionById>>,
  data: AnyRecord,
  dependencies: ChatWebSocketDependencies,
  extraRuntimeOptions: AnyRecord = {},
  beforeRun?: (run: NonNullable<ReturnType<typeof chatRunRegistry.startRun>>) => void | Promise<void>,
  requestType: ChatRequestType = 'chat.send',
): Promise<{ started: boolean; error: string | null }> {
  const provider = session.provider as LLMProvider;

  const run = chatRunRegistry.startRun({
    appSessionId: sessionId,
    provider,
    providerSessionId: session.provider_session_id,
    connection: ws,
    userId,
  });

  if (!run) {
    if (ws) {
      sendProtocolError(
        ws,
        'RUN_IN_PROGRESS',
        `Session "${sessionId}" already has a run in progress.`,
        sessionId,
        requestType,
      );
    }
    return { started: false, error: 'A run is already in progress for this session.' };
  }

  const clientOptions = (data.options ?? {}) as AnyRecord;
  const command = typeof data.content === 'string' ? data.content : '';

  // Record what this turn runs with so reopening the session later restores the
  // same model and reasoning effort, and so the resume path has a
  // session-scoped model answer to use.
  if (typeof clientOptions.model === 'string' && clientOptions.model.trim()) {
    providerModelsService.setSessionModel(provider, sessionId, clientOptions.model);
  }
  if (typeof clientOptions.effort === 'string' && clientOptions.effort.trim()) {
    providerModelsService.setSessionEffort(provider, sessionId, clientOptions.effort);
  }

  const { attachments: uniqueAttachments, images, files } = resolveVerifiedAttachments(clientOptions);

  // The provider runtimes receive the stable app session id. When their
  // CLI/SDK needs the provider-native id for resume, they resolve it from the
  // session row themselves (sessionsService.resolveProviderSessionId).
  // Brand-new sessions have no provider id yet, so the runtime starts fresh
  // and announces one, which the gateway writer captures and maps back to the
  // app session id.
  const runtimeOptions: AnyRecord = {
    ...clientOptions,
    ...extraRuntimeOptions,
    // Attachments are re-validated server-side: only direct children of the
    // global upload store may reach provider runtimes or their file tools.
    attachments: uniqueAttachments,
    images,
    files,
    sessionId,
    cwd: clientOptions.cwd ?? session.project_path ?? undefined,
    projectPath: session.project_path ?? clientOptions.projectPath,
  };

  let failure: string | null = null;
  try {
    // Runs only now that the session is reserved, because an edit rewinds the
    // conversation here and a rewind for a run that was never admitted cannot
    // be taken back. Inside the try so a rewind that throws still releases the
    // run instead of leaving the session processing forever.
    await beforeRun?.(run);
    await dependencies.runtime.run(provider, command, runtimeOptions, run.writer);
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    console.error(`[Chat] Provider runtime "${provider}" failed`, { sessionId, error: failure });
  } finally {
    // Safety net: a runtime that crashed (or resolved) without emitting its
    // terminal `complete` would otherwise leave the session stuck in
    // "processing" forever on every connected client. Scoped to THIS run —
    // a queued message can start the session's next run before this promise
    // settles, and the session-keyed completeRun would kill that new run.
    chatRunRegistry.completeRunIfCurrent(run, { exitCode: 1 });
  }

  return { started: true, error: failure };
}

/**
 * Handles `chat.edit-send`: replaces an already-sent message and everything
 * after it with a new turn.
 *
 * Nothing is deleted. The provider resumes the conversation partway and
 * appends the replacement, so the abandoned attempt stays in the transcript
 * file and is simply no longer part of the live conversation — the same shape
 * Claude Code's rewind and Codex's fork-with-cut-point produce.
 */
async function handleChatEditSend(
  ws: WebSocket,
  userId: string | number | null,
  data: AnyRecord,
  dependencies: ChatWebSocketDependencies
): Promise<void> {
  const resolved = resolveSendTarget(ws, data, dependencies, 'chat.edit-send');
  if (!resolved) {
    return;
  }

  const { sessionId, session, provider } = resolved;
  const anchorId = typeof data.anchorId === 'string' ? data.anchorId.trim() : '';
  if (!anchorId) {
    sendProtocolError(ws, 'ANCHOR_REQUIRED', 'chat.edit-send requires the anchorId of the message being replaced.', sessionId);
    return;
  }

  let resumeThroughId: string | null;
  try {
    const anchor = await sessionsService.resolveEditAnchor(sessionId, anchorId);
    if (!anchor) {
      sendProtocolError(
        ws,
        'EDIT_NOT_SUPPORTED',
        `Provider "${provider}" cannot replace an already-sent message.`,
        sessionId
      );
      return;
    }
    if (!anchor.found) {
      sendProtocolError(ws, 'ANCHOR_NOT_FOUND', 'That message is no longer in the transcript.', sessionId);
      return;
    }
    resumeThroughId = anchor.resumeThroughId;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendProtocolError(ws, 'ANCHOR_LOOKUP_FAILED', `Could not read the transcript: ${message}`, sessionId);
    return;
  }

  // Providers split here on what their runtime can do. Claude resumes its
  // transcript partway, so the anchor rides along as a run option. Codex
  // cannot — a thread only grows — so the conversation is rewound on disk and
  // the run that follows is an ordinary resume of whatever the session then
  // points at. Which of the two applies is decided here; the rewind itself
  // waits until the run has actually been admitted.
  const rewinds = sessionsService.providerRewindsForEdit(sessionId);

  await dispatchRun(
    ws,
    userId,
    sessionId,
    session,
    data,
    dependencies,
    // `null` is meaningful: the edited turn was the first prompt, so the
    // conversation starts over instead of resuming.
    rewinds
      ? {}
      : { resumeAnchorId: resumeThroughId ?? undefined, resumeFromScratch: resumeThroughId === null },
    async (run) => {
      // Emitted through the run's writer so it is sequenced and replayed like
      // any other event — a second tab watching this session has to truncate
      // too.
      //
      // Before the rewind, not after it. A rewind that has to branch spawns a
      // process and waits on a JSON-RPC round trip, and holding the frame
      // until that came back left the message the user had just edited away
      // sitting on screen for about a second — the very flicker this feature
      // exists to avoid. Announcing first is safe because a rewind that fails
      // still ends the run, and the terminal `complete` makes every client
      // re-read the transcript, which puts back anything that turned out not
      // to have been replaced after all.
      run.writer.send({
        kind: 'history_truncated',
        provider,
        sessionId,
        anchorId,
      });

      if (rewinds) {
        try {
          await sessionsService.rewindSessionForEdit(sessionId, resumeThroughId);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          sendProtocolError(ws, 'EDIT_REWIND_FAILED', `Could not rewind the conversation: ${message}`, sessionId);
          // Ends the run before the provider is asked to continue a
          // conversation that was not rewound after all.
          throw error;
        }
      }
    },
    'chat.edit-send',
  );
}

/**
 * Handles `chat.abort`: cancels the run for one app session and emits the
 * terminal `complete` on its behalf (runtimes skip their own complete for
 * aborted runs, and the registry drops any duplicate).
 */
async function handleChatAbort(
  ws: WebSocket,
  data: AnyRecord,
  dependencies: ChatWebSocketDependencies
): Promise<void> {
  const sessionId = readRequiredSessionId(data);
  if (!sessionId) {
    sendProtocolError(ws, 'SESSION_ID_REQUIRED', 'chat.abort requires a sessionId.');
    return;
  }

  const run = chatRunRegistry.getRun(sessionId);
  if (!run || run.status !== 'running') {
    sendProtocolError(ws, 'NO_ACTIVE_RUN', `Session "${sessionId}" has no active run.`, sessionId);
    return;
  }

  const success = await dependencies.runtime.abort(run.provider, sessionId);

  chatRunRegistry.completeRun(sessionId, {
    exitCode: success ? 0 : 1,
    aborted: true,
  });
}

/**
 * Handles `chat.stop-task`: stops one background task of a session — an
 * agent, a workflow or a backgrounded command that is still going after its
 * turn ended. Unlike `chat.abort` there is no run to consult: the task lives
 * in the provider's held process, which is the only thing that can stop it.
 * The provider then reports the task as stopped on the session's stream, so
 * nothing is echoed back here on success.
 */
async function handleChatStopTask(
  ws: WebSocket,
  data: AnyRecord,
  dependencies: ChatWebSocketDependencies
): Promise<void> {
  const sessionId = readRequiredSessionId(data);
  if (!sessionId) {
    sendProtocolError(ws, 'SESSION_ID_REQUIRED', 'chat.stop-task requires a sessionId.');
    return;
  }

  const taskId = typeof data.taskId === 'string' ? data.taskId.trim() : '';
  if (!taskId) {
    sendProtocolError(ws, 'TASK_ID_REQUIRED', 'chat.stop-task requires a taskId.', sessionId);
    return;
  }

  const session = sessionsDb.getSessionById(sessionId);
  if (!session) {
    sendProtocolError(ws, 'SESSION_NOT_FOUND', `Session "${sessionId}" was not found.`, sessionId);
    return;
  }

  const stopped = await dependencies.runtime.stopBackgroundTask(
    session.provider as LLMProvider,
    sessionId,
    taskId,
  );
  if (!stopped) {
    sendProtocolError(
      ws,
      'NO_SUCH_TASK',
      `Session "${sessionId}" has no running background task "${taskId}".`,
      sessionId,
    );
  }
}

/**
 * Handles `chat.subscribe`: for each requested session, reports whether a run
 * is processing, re-attaches the live stream to this socket, replays missed
 * events (seq > lastSeq), and includes pending permission requests.
 *
 * This single message replaces the old `check-session-status`,
 * `get-pending-permissions`, and Claude-only writer reconnect flows.
 */
function handleChatSubscribe(
  ws: WebSocket,
  data: AnyRecord,
  dependencies: ChatWebSocketDependencies
): void {
  const targets = Array.isArray(data.sessions) ? data.sessions : [];

  for (const target of targets) {
    if (!target || typeof target !== 'object') {
      continue;
    }

    const sessionId = typeof (target as AnyRecord).sessionId === 'string'
      ? ((target as AnyRecord).sessionId as string).trim()
      : '';
    if (!sessionId) {
      continue;
    }

    const lastSeqRaw = (target as AnyRecord).lastSeq;
    const lastSeq = typeof lastSeqRaw === 'number' && Number.isFinite(lastSeqRaw)
      ? Math.max(0, Math.floor(lastSeqRaw))
      : 0;

    const run = chatRunRegistry.getRun(sessionId);
    const isProcessing = chatRunRegistry.isProcessing(sessionId);

    // Future live events for this run should land on the socket that asked —
    // this is what makes mid-stream page refreshes work for all providers.
    // A session whose turn ended but whose background work is still going
    // keeps producing events through the same writer (task progress, the
    // turn the CLI pushes when a task reports), so a tab opened during that
    // work attaches too; the registry keeps the run while the work lasts.
    if (isProcessing || dependencies.runtime.hasBackgroundWork(sessionId)) {
      chatRunRegistry.attachConnection(sessionId, ws);
    }

    // Pending approvals are tracked under the app session id inside the
    // Claude runtime, so they can be looked up directly.
    const pendingPermissions = dependencies.runtime.getPendingApprovalsForSession(sessionId);

    sendJson(ws, {
      kind: 'chat_subscribed',
      sessionId,
      isProcessing,
      lastSeq: run?.lastSeq ?? 0,
      pendingPermissions,
      timestamp: new Date().toISOString(),
    });

    // Replay only for RUNNING runs, strictly after the ack. Completed runs
    // are fully persisted to the provider transcript and served over REST —
    // replaying them (e.g. after a page reload where the client's lastSeq is
    // 0) would duplicate messages the history fetch already returned.
    if (isProcessing) {
      for (const event of chatRunRegistry.replayEvents(sessionId, lastSeq)) {
        sendJson(ws, event);
      }
    }
  }
}

/**
 * Handles `chat.permission-response`: forwards a tool-approval decision to the
 * pending approval resolver (Claude is the only provider with interactive
 * approvals today, but the message is intentionally provider-neutral).
 */
function handlePermissionResponse(data: AnyRecord, dependencies: ChatWebSocketDependencies): void {
  if (typeof data.requestId !== 'string' || data.requestId.length === 0) {
    return;
  }

  dependencies.runtime.resolveToolApproval(data.requestId, {
    allow: Boolean(data.allow),
    updatedInput: data.updatedInput,
    message: typeof data.message === 'string' ? data.message : undefined,
    rememberEntry: data.rememberEntry,
  });
}

/**
 * Handles authenticated chat websocket messages used by the main chat panel.
 *
 * Inbound protocol (client to server):
 * - `chat.send`                { sessionId, content, options? } — `options.interrupt === true`
 *                               aborts a running turn first instead of refusing with `RUN_IN_PROGRESS`.
 * - `chat.steer`                { sessionId, content, options? } — while a turn is running, folds the
 *                               message into it instead of queuing/refusing; idle sessions behave like `chat.send`.
 * - `chat.abort`               { sessionId }
 * - `chat.stop-task`           { sessionId, taskId }
 * - `chat.subscribe`           { sessions: [{ sessionId, lastSeq? }] }
 * - `chat.permission-response` { requestId, allow, updatedInput?, message?, rememberEntry? }
 *
 * Outbound protocol (server to client): every frame is `kind`-based — either
 * a provider `NormalizedMessage` (with `seq`) or a gateway event
 * (`chat_subscribed`, `session_upserted`, `loading_progress`,
 * `protocol_error`).
 */
/**
 * Runs a turn for a session with no client attached.
 *
 * Used by scheduled messages, which fire from a timer: there is no socket to
 * report errors to and no audience to stream to. The run is registered exactly
 * like an interactive one, so anyone who opens the session while it is going
 * subscribes and replays it from the start, and the session shows as busy
 * everywhere in the meantime.
 *
 * Resolves when the provider run settles. Returns false when the session has
 * gone away or is busy without `interruptActiveRun`, which the caller reports
 * on the schedule.
 */
export async function runDetachedChatTurn(
  input: {
    sessionId: string;
    userId: string | number | null;
    content: string;
    options?: AnyRecord;
    /**
     * Aborts a run already in progress instead of refusing to start. A
     * scheduled message sets this: the user picked the time knowing it might
     * land mid-run, so the timer outranks whatever is running.
     */
    interruptActiveRun?: boolean;
  },
  dependencies: ChatWebSocketDependencies,
): Promise<{ started: boolean; error: string | null }> {
  const session = sessionsDb.getSessionById(input.sessionId);
  if (!session) {
    return { started: false, error: 'The session no longer exists.' };
  }

  const provider = session.provider as LLMProvider;
  if (!dependencies.runtime.hasRuntime(provider)) {
    return { started: false, error: `Provider "${provider}" is not available.` };
  }

  const activeRun = chatRunRegistry.getRun(input.sessionId);
  if (activeRun && activeRun.status === 'running') {
    if (!input.interruptActiveRun) {
      return { started: false, error: 'A run was already in progress for this session.' };
    }
    // Same shape as `chat.abort`: cancel the provider run and emit the
    // terminal `complete` on its behalf, so every watching client sees the
    // interrupted run end before this turn's stream begins. The interrupted
    // run's own dispatch settles later through completeRunIfCurrent, which is
    // scoped to that run and cannot touch the one started here.
    await abortRunningRun(dependencies, activeRun.provider, input.sessionId);
  }

  return dispatchRun(
    null,
    input.userId,
    input.sessionId,
    session,
    { sessionId: input.sessionId, content: input.content, options: input.options ?? {} },
    dependencies,
  );
}

export function handleChatConnection(
  ws: WebSocket,
  request: AuthenticatedWebSocketRequest,
  dependencies: ChatWebSocketDependencies
): void {
  console.log('[INFO] Chat WebSocket connected');
  connectedClients.add(ws);

  const userId = readRequestUserId(request);

  ws.on('message', async (rawMessage) => {
    try {
      const parsed = parseIncomingJsonObject(rawMessage);
      if (!parsed) {
        throw new Error('Invalid websocket payload');
      }

      const data = parsed as AnyRecord;
      const messageType = typeof data.type === 'string' ? data.type : '';

      switch (messageType) {
        case 'chat.edit-send':
          await handleChatEditSend(ws, userId, data, dependencies);
          return;
        case 'chat.send':
          await handleChatSend(ws, userId, data, dependencies);
          return;
        case 'chat.steer':
          await handleChatSteer(ws, userId, data, dependencies);
          return;
        case 'chat.abort':
          await handleChatAbort(ws, data, dependencies);
          return;
        case 'chat.stop-task':
          await handleChatStopTask(ws, data, dependencies);
          return;
        case 'chat.subscribe':
          handleChatSubscribe(ws, data, dependencies);
          return;
        case 'chat.permission-response':
          handlePermissionResponse(data, dependencies);
          return;
        default:
          sendProtocolError(ws, 'UNKNOWN_MESSAGE_TYPE', `Unknown message type "${messageType}".`);
          return;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[ERROR] Chat WebSocket error:', message);
      sendProtocolError(ws, 'INTERNAL_ERROR', message);
    }
  });

  ws.on('close', () => {
    console.log('[INFO] Chat client disconnected');
    connectedClients.delete(ws);
  });
}
