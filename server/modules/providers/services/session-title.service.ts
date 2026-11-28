import { sessionsDb } from '@/modules/database/index.js';
import { generateClaudeSessionTitle } from '@/modules/providers/list/claude/claude-title.provider.js';
import { broadcastSessionUpserted } from '@/modules/websocket/index.js';
import type { LLMProvider } from '@/shared/index.js';

/**
 * Asks the model for a readable name for a freshly created session.
 *
 * A session is created with the truncated first message as its name so the
 * sidebar has something to show immediately. This then replaces it with a
 * title the model wrote from that message — the same thing the Claude CLI does
 * for sessions it starts itself, and the reason its own `/resume` list is
 * readable. Naming never blocks creation and never fails it: any error leaves
 * the truncated name in place.
 */

/** Sessions whose naming request is already running, so a retry cannot double-charge. */
const inFlight = new Set<string>();

export type SessionTitleRequest = {
  sessionId: string;
  provider: LLMProvider;
  projectPath: string;
  firstMessage: string;
  /** The name written at creation; a different stored value means the user renamed it. */
  initialName: string;
  /** Optional session/default model used as fallback if the small model fails. */
  model?: string | null;
};

/**
 * Starts naming in the background. Returns immediately: the caller is the
 * session-creation path, which must answer the client without waiting on a
 * model round trip.
 */
export function scheduleSessionTitleGeneration(
  request: SessionTitleRequest,
  // The query is replaceable so the naming rules can be tested without a model
  // round trip; production never passes it.
  options: { generate?: typeof generateClaudeSessionTitle } = {},
): void {
  // Only Claude has a query path here. The other providers keep the name their
  // synchronizer derives, which is the same fallback this uses on failure.
  if (request.provider !== 'claude') {
    return;
  }
  if (inFlight.has(request.sessionId)) {
    return;
  }

  const generate = options.generate ?? generateClaudeSessionTitle;
  inFlight.add(request.sessionId);
  void generateAndStore(request, generate).finally(() => inFlight.delete(request.sessionId));
}

/**
 * Runs one naming request and stores the result. Swallows every failure: a
 * session without a model-written title is normal, and a rejected promise here
 * would surface as an unhandled rejection in the creation path.
 */
async function generateAndStore(
  request: SessionTitleRequest,
  generate: typeof generateClaudeSessionTitle,
): Promise<void> {
  try {
    const title = await generate(request.firstMessage, {
      cwd: request.projectPath,
      model: request.model ?? undefined,
    });
    if (!title) {
      return;
    }

    const current = sessionsDb.getSessionById(request.sessionId);
    // Renamed while the model was thinking: that name is the user's, not ours.
    if (!current || current.custom_name !== request.initialName) {
      return;
    }

    sessionsDb.updateSessionCustomName(request.sessionId, title);
    await broadcastSessionUpserted(request.sessionId);
  } catch {
    // Naming is a nicety; the session already has a usable name.
  }
}
