import { broadcastToConnectedClients } from '@/modules/websocket/index.js';

import type {
  LLMProvider,
  SideQuestion,
  SideQuestionEvent,
  SideQuestionRuntime,
} from '@/shared/types.js';
import {
  createInMemorySideQuestionsStore,
  type InMemorySideQuestionsStore,
} from './side-questions.store.js';

type SideQuestionsServiceDependencies = {
  /** Defaults to a fresh in-memory store: a new service instance is empty. */
  store?: InMemorySideQuestionsStore;
  maxPerSession?: number;
};

/** What the websocket handler supplies when a `chat.side_question` frame is accepted. */
type AskInput = {
  sessionId: string;
  provider: LLMProvider;
  providerSessionId: string | null;
  projectPath: string | null;
  sideQuestionId: string;
  question: string;
  model: string | null;
};

/**
 * Not a measured value: the store lives in the server's memory for weeks, so
 * the list per session has a bound. 50 is far above the asides one session
 * plausibly carries, so a real chat never hits it.
 */
export const MAX_SIDE_QUESTIONS_PER_SESSION = 50;

/**
 * Broadcasts a side-question event to every connected chat client. The
 * default `notify` for `ask`/`dismiss` below; tests inject their own to
 * assert on the events without a real websocket.
 */
function broadcastSideQuestionEvent(event: SideQuestionEvent): void {
  broadcastToConnectedClients(JSON.stringify(event));
}

/**
 * Builds the side-questions service: a long-lived, session-independent
 * runner for questions asked on the side while a chat session is active.
 *
 * `ask` is never tied to a socket — a closed tab does not abort the question
 * it started, only an explicit `dismiss` does. Used by the websocket module's
 * `chat.side_question` handler and the provider routes' side-question endpoints.
 *
 * State is the in-memory store, never a table: a CloudCLI restart drops every
 * question, so a new service instance starts empty and nothing can be left
 * running for a restart to recover.
 */
export function createSideQuestionsService(dependencies: SideQuestionsServiceDependencies = {}) {
  const store = dependencies.store ?? createInMemorySideQuestionsStore();
  const maxPerSession = dependencies.maxPerSession ?? MAX_SIDE_QUESTIONS_PER_SESSION;
  // Keyed by side-question id (unique across sessions), so `dismiss` can abort
  // the one in-flight runtime call without knowing which session owns it.
  const controllers = new Map<string, AbortController>();

  function notifyDismissed(sessionId: string, id: string, notify: (event: SideQuestionEvent) => void): void {
    notify({
      kind: 'side_question',
      sessionId,
      sideQuestionId: id,
      phase: 'dismissed',
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Aborts a side question if it is still running, then deletes it.
   * Returns whether a question actually went, so the route can answer 404 or 200.
   *
   * Looks the question up by id first: a hit that belongs to another session is
   * left completely alone (not aborted, not deleted) and reported as if it
   * did not exist, so one session can never stop or erase another's
   * question just by guessing its id.
   *
   * `notify` is told about a successful dismiss (`phase: 'dismissed'`) so
   * every connected client — not just the asker — drops the id instead of
   * leaving it pending until a full reload. Defaults to broadcasting on the
   * websocket; tests inject their own to assert on the event instead.
   */
  function dismiss(
    sessionId: string,
    id: string,
    notify: (event: SideQuestionEvent) => void = broadcastSideQuestionEvent,
  ): boolean {
    const existing = store.getById(id);
    if (!existing || existing.sessionId !== sessionId) {
      return false;
    }

    controllers.get(id)?.abort();
    const deleted = store.delete(sessionId, id);
    if (deleted) {
      notifyDismissed(sessionId, id, notify);
    }
    return deleted;
  }

  /**
   * Makes room under the per-session cap: dismisses the session's oldest
   * question, whatever its status, exactly as `dismiss` does (abort the
   * runtime call, delete, notify `dismissed`) so no child process keeps
   * running and every tab drops it. Other sessions are untouched.
   */
  function makeRoom(sessionId: string, notify: (event: SideQuestionEvent) => void): void {
    const list = store.listForSession(sessionId);
    if (list.length < maxPerSession) {
      return;
    }
    dismiss(sessionId, list[0].id, notify);
  }

  /**
   * Starts one side question: creates it in the store, notifies `started`,
   * drives the runtime call with a sink that appends each delta and
   * broadcasts it, then settles the question and notifies `done` or `error`
   * with the whole question.
   *
   * Resolves once the question is fully settled. Callers that only need the
   * frame accepted (not the answer) should not await this.
   */
  async function ask(
    input: AskInput,
    runtime: SideQuestionRuntime,
    notify: (event: SideQuestionEvent) => void = broadcastSideQuestionEvent,
  ): Promise<void> {
    // The cap is checked before creating: the evicted question's `dismissed`
    // is announced before the new question's `started`, so no tab ever sees
    // more than the cap for this session.
    makeRoom(input.sessionId, notify);

    const sideQuestion = store.create({
      id: input.sideQuestionId,
      sessionId: input.sessionId,
      question: input.question,
      model: input.model,
    });

    notify({
      kind: 'side_question',
      sessionId: input.sessionId,
      sideQuestionId: input.sideQuestionId,
      phase: 'started',
      sideQuestion,
      timestamp: new Date().toISOString(),
    });

    const controller = new AbortController();
    controllers.set(input.sideQuestionId, controller);

    try {
      // Race the runtime call against the abort signal so that a `dismiss`
      // while the runtime is still working resolves `ask` immediately, even
      // if the runtime never reacts to the signal (test runtimes, or a runtime
      // that hangs after abort). The runtime's own response to the abort is
      // discarded.
      const outcome = await new Promise<import('@/shared/types.js').SideQuestionOutcome>((resolve, reject) => {
        const abortListener = () => {
          cleanup();
          resolve({ status: 'error', error: 'aborted', answer: '' });
        };
        const cleanup = () => {
          controller.signal.removeEventListener('abort', abortListener);
        };
        if (controller.signal.aborted) {
          cleanup();
          resolve({ status: 'error', error: 'aborted', answer: '' });
          return;
        }
        controller.signal.addEventListener('abort', abortListener, { once: true });
        runtime
          .askSideQuestion(
            input.provider,
            {
              appSessionId: input.sessionId,
              providerSessionId: input.providerSessionId,
              projectPath: input.projectPath,
              question: input.question,
              model: input.model,
              signal: controller.signal,
            },
            {
              delta: (text: string) => {
                store.appendAnswer(input.sideQuestionId, text);
                notify({
                  kind: 'side_question',
                  sessionId: input.sessionId,
                  sideQuestionId: input.sideQuestionId,
                  phase: 'delta',
                  text,
                  timestamp: new Date().toISOString(),
                });
              },
            },
          )
            .then((result) => {
              cleanup();
              resolve(result);
            })
            .catch((error: unknown) => {
              cleanup();
              reject(error);
            });
      });

      // A dismiss while the runtime was still working already deleted the
      // question; settling it here would resurrect something the caller
      // removed.
      if (!store.getById(input.sideQuestionId)) {
        return;
      }

      store.finish(input.sideQuestionId, outcome);
      const finished = store.getById(input.sideQuestionId);
      if (!finished) {
        return;
      }

      notify({
        kind: 'side_question',
        sessionId: input.sessionId,
        sideQuestionId: input.sideQuestionId,
        phase: outcome.status === 'done' ? 'done' : 'error',
        error: outcome.status === 'error' ? outcome.error : undefined,
        sideQuestion: finished,
        timestamp: new Date().toISOString(),
      });
    } finally {
      controllers.delete(input.sideQuestionId);
    }
  }

  /** The session's whole side-question list, oldest first, for the history route. */
  function listForSession(sessionId: string): SideQuestion[] {
    return store.listForSession(sessionId);
  }

  /** The one side question by id, whatever session it belongs to, or null. */
  function getById(id: string): SideQuestion | null {
    return store.getById(id);
  }

  return { ask, listForSession, dismiss, getById };
}

/** Default instance, consumed through `@/modules/providers/index.js`. */
export const sideQuestionsService = createSideQuestionsService();
