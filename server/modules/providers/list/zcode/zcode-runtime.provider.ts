/**
 * ZCode Runtime Provider
 *
 * Implements IProviderRuntime for ZCode integration using the app-server protocol.
 * Handles session lifecycle, permission mode mapping, message streaming, and run completion.
 *
 * Protocol facts from the Phase 0 spike:
 * - Events only flow after `session/subscribe` (`deliveryKind:
 *   'desktop-continuous'`); subscribe may fail for inactive sessions (-32004)
 *   and is best-effort.
 * - `session/send` takes `content` (not `message`) and its result arrives on
 *   the event stream, so it is sent without a request timeout.
 * - The gateway keys aborts by the app-facing session id, which arrives in
 *   `options.sessionId`; the ZCode-native `sess_*` id is resolved/created and
 *   announced back via `writer.setSessionId` plus a `session_created` event.
 *
 * @module zcode-runtime.provider
 */

import type { IProviderRuntime } from '@/shared/interfaces.js';
import type {
  AnyRecord,
  NormalizedMessage,
  ProviderRuntimeContext,
  ProviderRuntimeWriter,
} from '@/shared/types.js';
import { createCompleteMessage, createNormalizedMessage, generateMessageId, readOptionalString } from '@/shared/utils.js';

import { protocolClient } from './zcode-protocol.client.js';
import { readZCodeSessionModelFromDb } from './zcode-models.provider.js';

/**
 * Permission mode mapping from CloudCLI to ZCode (§5 of integration plan).
 *
 * Maps the application's permission modes to ZCode's native modes:
 * - default → build (zcode default)
 * - acceptEdits → edit
 * - plan → plan
 * - bypassPermissions → yolo (zcode headless default)
 * - auto → auto
 */
const PERMISSION_MODE_MAP: Record<string, string> = {
  default: 'build',
  acceptEdits: 'edit',
  plan: 'plan',
  bypassPermissions: 'yolo',
  auto: 'auto',
};

/**
 * Active session tracking for abort capability.
 * Keys are app-facing session ids (what `abort` receives from the chat
 * gateway); values are ZCode-native session ids passed to `session/stop`.
 */
const activeSessions = new Map<string, string>();

/**
 * Session completion tracking to ensure exactly one complete event per run.
 * Maps ZCode session IDs to completion state; `tokenUsage` is the run's
 * total used-token count carried on the final complete message.
 */
const sessionCompletionState = new Map<string, { completed: boolean; tokenUsage?: number }>();

/**
 * ZCode Runtime Provider Implementation
 *
 * Manages ZCode session execution using the app-server protocol, handling:
 * - Session creation/resolution
 * - Model and mode configuration
 * - Event subscription, message sending and event streaming
 * - Session abortion and cleanup
 * - Token usage aggregation
 */
export class ZCodeRuntimeProvider implements IProviderRuntime {
  /**
   * Executes a command in a ZCode session.
   *
   * Flow per §3.2.3 of integration plan:
   * 1. Resolve existing session via context.resolveProviderSessionId()
   * 2. Create session if needed and announce it back to the gateway
   * 3. Subscribe to session events so the event stream starts flowing
   * 4. Set model if different from the session's current model
   * 5. Map permission mode and call session/setMode
   * 6. Send user message via session/send
   * 7. Wait for the run end event, then send exactly one complete with tokens
   */
  async run(
    command: string,
    options: AnyRecord = {},
    writer: ProviderRuntimeWriter,
    context: ProviderRuntimeContext,
  ): Promise<unknown> {
    const appSessionId = readOptionalString(options.sessionId) ?? null;
    const zcodeSessionId = await this.resolveOrCreateSession(appSessionId, options, context, writer);

    // Abort is requested with the app-facing id; fall back to the ZCode id
    // for callers (e.g. tests) that never supplied one.
    const abortKey = appSessionId ?? zcodeSessionId;
    activeSessions.set(abortKey, zcodeSessionId);
    sessionCompletionState.set(zcodeSessionId, { completed: false });

    try {
      await this.subscribeToSessionEvents(zcodeSessionId);
      await this.configureSessionModel(zcodeSessionId, options);
      await this.configureSessionMode(zcodeSessionId, options);

      const eventListener = this.createSessionEventListener(zcodeSessionId, writer, context);
      protocolClient.addSessionListener(zcodeSessionId, eventListener);

      try {
        await this.sendUserMessage(zcodeSessionId, command, options);
        await this.waitForCompletion(zcodeSessionId, abortKey);
        this.sendCompletionEvent(zcodeSessionId, writer);

        return { sessionId: zcodeSessionId, success: true };
      } finally {
        protocolClient.removeSessionListener(zcodeSessionId, eventListener);
      }
    } catch (error) {
      // Surface the failure to the chat stream before propagating it.
      const errorMessage = createNormalizedMessage({
        id: generateMessageId('zcode'),
        sessionId: zcodeSessionId,
        provider: 'zcode',
        kind: 'error',
        isError: true,
        text: error instanceof Error ? error.message : 'Unknown ZCode runtime error',
      });
      writer.send(errorMessage);

      throw error;
    } finally {
      activeSessions.delete(abortKey);
      sessionCompletionState.delete(zcodeSessionId);
    }
  }

  /**
   * Aborts an active ZCode session.
   *
   * Calls `session/stop` for the ZCode session mapped to the given app-facing
   * session id (no SIGINT fallback per §3.2.3 - the app-server process is
   * shared across sessions). Uses protocol-level retry on failure.
   *
   * @param sessionId - CloudCLI app session ID to abort
   * @returns boolean indicating if abort was successful
   */
  async abort(sessionId: string): Promise<boolean> {
    const zcodeSessionId = activeSessions.get(sessionId);

    if (!zcodeSessionId) {
      console.warn(`[ZCodeRuntime] No active session found for ${sessionId}`);
      return false;
    }

    try {
      // Mark session as completed to prevent duplicate complete events
      const completionState = sessionCompletionState.get(zcodeSessionId);
      if (completionState) {
        completionState.completed = true;
      }

      await this.callWithRetry(
        async () => {
          await protocolClient.sendRequest('session/stop', {
            sessionId: zcodeSessionId,
          });
        },
        'session/stop',
        3
      );

      console.info(`[ZCodeRuntime] Aborted session ${zcodeSessionId}`);
      return true;
    } catch (error) {
      console.error(`[ZCodeRuntime] Failed to abort session ${zcodeSessionId}:`, error);
      return false;
    } finally {
      activeSessions.delete(sessionId);
    }
  }

  /**
   * Optional permission gateway (first version uses mode mapping only).
   *
   * Per §3.2.3: first version uses mode mapping instead of per-tool approval.
   * ZCode headless defaults to yolo mode. Can map toolsSettings to protocol
   * equivalents in future (Phase 0.1 to confirm structure).
   */
  permissions?: undefined;

  /**
   * Resolves existing session or creates new one.
   *
   * Implements session resolution flow from §3.2.3:
   * 1. Resolve existing session via context.resolveProviderSessionId() with
   *    the app-facing session id
   * 2. If no session, call session/create for the run's workspace
   * 3. Report the returned sess_* id back to the gateway (setSessionId plus
   *    a session_created event, matching the claude-runtime pattern)
   */
  private async resolveOrCreateSession(
    appSessionId: string | null,
    options: AnyRecord,
    context: ProviderRuntimeContext,
    writer: ProviderRuntimeWriter,
  ): Promise<string> {
    const existingSessionId = appSessionId
      ? context.resolveProviderSessionId(appSessionId)
      : null;

    if (existingSessionId) {
      console.debug(`[ZCodeRuntime] Resolved existing session: ${existingSessionId}`);
      return existingSessionId;
    }

    const workspacePath = readOptionalString(options.workspacePath)
      ?? readOptionalString(options.cwd)
      ?? process.cwd();

    console.info(`[ZCodeRuntime] Creating new session for workspace: ${workspacePath}`);

    try {
      const result = await protocolClient.sendRequest<{ sessionId: string }>(
        'session/create',
        {
          workspacePath,
          deliveryKind: 'interactive',
        }
      );

      const newSessionId = readOptionalString(result?.sessionId);
      if (!newSessionId) {
        throw new Error('session/create returned no sessionId');
      }

      writer.setSessionId?.(newSessionId);

      const sessionCreatedEvent = createNormalizedMessage({
        id: generateMessageId('zcode'),
        sessionId: newSessionId,
        provider: 'zcode',
        kind: 'session_created',
        content: `Session created: ${newSessionId}`,
      });
      writer.send(sessionCreatedEvent);

      console.info(`[ZCodeRuntime] Created new session: ${newSessionId}`);
      return newSessionId;
    } catch (error) {
      console.error('[ZCodeRuntime] Failed to create session:', error);
      throw new Error(`Failed to create ZCode session: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Subscribes to the session's event stream.
   *
   * `session/subscribe` with `deliveryKind: 'desktop-continuous'` is what
   * turns on `session/event` notifications (Phase 0.1 validation). It can
   * legitimately fail for inactive sessions (-32004), so failures are logged
   * and the run continues - the completion wait falls back to its timeout.
   */
  private async subscribeToSessionEvents(sessionId: string): Promise<void> {
    try {
      await protocolClient.sendRequest('session/subscribe', {
        sessionId,
        deliveryKind: 'desktop-continuous',
      });
      console.debug(`[ZCodeRuntime] Subscribed to events for session ${sessionId}`);
    } catch (error) {
      console.warn(`[ZCodeRuntime] Subscribe failed for session ${sessionId}:`, error);
    }
  }

  /**
   * Configures session model when it differs from the session's current model.
   *
   * The current model is read from ZCode's own database (most recent
   * `message.data.modelID`); `session/setModel` is skipped when the requested
   * model already matches, per §3.2.3 step 2.
   */
  private async configureSessionModel(
    sessionId: string,
    options: AnyRecord,
  ): Promise<void> {
    const requestedModel = readOptionalString(options.model);

    if (!requestedModel) {
      return; // No model change requested
    }

    const currentModel = readZCodeSessionModelFromDb(sessionId);
    if (currentModel === requestedModel) {
      return; // Session already runs the requested model
    }

    try {
      await protocolClient.sendRequest('session/setModel', {
        sessionId,
        model: requestedModel,
      });

      console.debug(`[ZCodeRuntime] Set model for session ${sessionId}: ${requestedModel}`);
    } catch (error) {
      console.warn(`[ZCodeRuntime] Failed to set model ${requestedModel} for session ${sessionId}:`, error);
      // Continue anyway - use session's existing model
    }
  }

  /**
   * Configures session permission mode using mapping from §5.
   *
   * Maps CloudCLI permission modes to ZCode modes and calls session/setMode.
   */
  private async configureSessionMode(
    sessionId: string,
    options: AnyRecord,
  ): Promise<void> {
    const permissionMode = readOptionalString(options.permissionMode) ?? 'default';

    const zcodeMode = PERMISSION_MODE_MAP[permissionMode] ?? 'build';

    try {
      await protocolClient.sendRequest('session/setMode', {
        sessionId,
        mode: zcodeMode,
      });

      console.debug(`[ZCodeRuntime] Set mode for session ${sessionId}: ${permissionMode} → ${zcodeMode}`);
    } catch (error) {
      console.warn(`[ZCodeRuntime] Failed to set mode ${zcodeMode} for session ${sessionId}:`, error);
      // Continue with default mode
    }
  }

  /**
   * Sends user message to ZCode session.
   *
   * `session/send` is issued without a request timeout because its result
   * arrives on the event stream rather than as a protocol response.
   */
  private async sendUserMessage(
    sessionId: string,
    command: string,
    options: AnyRecord,
  ): Promise<void> {
    const messagePayload: AnyRecord = {
      sessionId,
      // Message content field: content (not message) per protocol findings
      content: command,
      deliveryKind: 'interactive',
    };

    if (Array.isArray(options.attachments)) {
      messagePayload.attachments = options.attachments;
    }

    try {
      await protocolClient.sendRequest('session/send', messagePayload, 0);
      console.debug(`[ZCodeRuntime] Sent message to session ${sessionId}`);
    } catch (error) {
      console.error(`[ZCodeRuntime] Failed to send message to session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Creates session event listener for normalizing protocol events to writer.
   *
   * Normalization goes through `context.normalizeMessage` (bound to the
   * provider's sessions facet) so live events and SQLite history share one
   * mapping. Internal `complete` messages only record token usage; the final
   * complete is emitted once by `sendCompletionEvent`.
   */
  private createSessionEventListener(
    sessionId: string,
    writer: ProviderRuntimeWriter,
    context: ProviderRuntimeContext,
  ): (notification: AnyRecord) => void {
    return (notification: AnyRecord) => {
      try {
        const method = readOptionalString(notification.method);
        if (method && method !== 'session/event') {
          console.debug(`[ZCodeRuntime] Received server request: ${method}`);
          return;
        }

        const normalizedMessages: NormalizedMessage[] = context.normalizeMessage(
          notification.params ?? notification,
          sessionId,
        );

        for (const message of normalizedMessages) {
          if (message.kind === 'complete') {
            const completionState = sessionCompletionState.get(sessionId);
            if (completionState) {
              completionState.tokenUsage = message.tokens;
              completionState.completed = true;
            }
            continue;
          }

          writer.send(message);
        }      } catch (error) {
        console.error(`[ZCodeRuntime] Error processing session event:`, error);
      }
    };
  }

  /**
   * Waits for session completion event.
   *
   * Polls sessionCompletionState until the completed flag is set, the run is
   * aborted (abort key removed), or the timeout elapses.
   */
  private async waitForCompletion(
    sessionId: string,
    abortKey: string,
    timeout: number = 10 * 60 * 1000,
  ): Promise<void> {
    const startTime = Date.now();
    const pollInterval = 100;

    while (Date.now() - startTime < timeout) {
      if (sessionCompletionState.get(sessionId)?.completed) {
        return;
      }

      if (!activeSessions.has(abortKey)) {
        throw new Error('Session was aborted');
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new Error(`Session completion timeout after ${timeout}ms`);
  }

  /**
   * Sends completion event with aggregated token usage.
   *
   * Ensures exactly ONE complete event per run per §3.2.3 requirements.
   * The shared `complete` envelope carries success/exit semantics; the run's
   * total used-token count rides the `tokens` field.
   */
  private sendCompletionEvent(
    sessionId: string,
    writer: ProviderRuntimeWriter,
  ): void {
    const tokenUsage = sessionCompletionState.get(sessionId)?.tokenUsage;

    const completeMessage = createCompleteMessage({
      provider: 'zcode',
      sessionId,
      exitCode: 0,
    });
    if (typeof tokenUsage === 'number') {
      completeMessage.tokens = tokenUsage;
    }

    writer.send(completeMessage);
    console.debug(`[ZCodeRuntime] Sent completion event for session ${sessionId}`);
  }

  /**
   * Calls protocol method with retry on failure.
   *
   * Protocol-level retry per §3.2.3 for operations like session/stop.
   */
  private async callWithRetry(
    fn: () => Promise<void>,
    operation: string,
    maxRetries: number = 3,
  ): Promise<void> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await fn();
        return;
      } catch (error) {
        if (attempt === maxRetries) {
          throw error;
        }
        console.warn(`[ZCodeRuntime] ${operation} attempt ${attempt} failed, retrying...`);
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }
}

/**
 * Singleton instance of the ZCode runtime provider.
 * Consumer: zcode provider class (exposed as the provider's runtime facet).
 */
export const zcodeRuntime = new ZCodeRuntimeProvider();
