import { sideQuestionsDb, type SideQuestionRow } from '@/modules/database/index.js';
import type {
  LLMProvider,
  SideQuestion,
  SideQuestionEvent,
  SideQuestionRuntime,
} from '@/shared/types.js';

/** Repository access the service needs, narrowed so tests can stub it. */
type SideQuestionsStore = Pick<
  typeof sideQuestionsDb,
  'create' | 'getById' | 'appendAnswer' | 'finish' | 'listForSession' | 'delete' | 'failRunning'
>;

type SideQuestionsServiceDependencies = {
  db?: SideQuestionsStore;
};

/** What the websocket handler supplies when a `chat.btw` frame is accepted. */
type AskInput = {
  sessionId: string;
  provider: LLMProvider;
  providerSessionId: string | null;
  projectPath: string | null;
  sideQuestionId: string;
  question: string;
  model: string | null;
};

/** Maps a database row (snake_case) to the wire/client shape (camelCase). */
function toSideQuestion(row: SideQuestionRow): SideQuestion {
  return {
    id: row.id,
    sessionId: row.session_id,
    question: row.question,
    answer: row.answer,
    status: row.status,
    error: row.error,
    model: row.model,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  };
}

/**
 * Builds the side-questions service: a long-lived, session-independent
 * runner for questions asked on the side while a chat session is active.
 *
 * `ask` is never tied to a socket — a closed tab does not abort the question
 * it started, only an explicit `dismiss` (or the process restarting) does.
 * Used by the websocket module's `chat.btw` handler and
 * `server/index.ts` (`recoverInterrupted`, once at startup).
 */
export function createSideQuestionsService(dependencies: SideQuestionsServiceDependencies = {}) {
  const db = dependencies.db ?? sideQuestionsDb;
  // Keyed by side-question id (unique across sessions), so `dismiss` can abort
  // the one in-flight runtime call without knowing which session owns it.
  const controllers = new Map<string, AbortController>();

  /**
   * Starts one side question: inserts its row, notifies `started`, drives the
   * runtime call with a sink that persists and broadcasts each delta, then
   * finishes the row and notifies `done` or `error` with the whole row.
   *
   * Resolves once the question is fully settled. Callers that only need the
   * frame accepted (not the answer) should not await this.
   */
  async function ask(
    input: AskInput,
    runtime: SideQuestionRuntime,
    notify: (event: SideQuestionEvent) => void,
  ): Promise<void> {
    const row = db.create({
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
      sideQuestion: toSideQuestion(row),
      timestamp: new Date().toISOString(),
    });

    const controller = new AbortController();
    controllers.set(input.sideQuestionId, controller);

    try {
      const outcome = await runtime.askSideQuestion(
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
            db.appendAnswer(input.sideQuestionId, text);
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
      );

      // A dismiss while the runtime was still working already deleted the
      // row; resolving it here would resurrect something the caller removed.
      if (!db.getById(input.sideQuestionId)) {
        return;
      }

      db.finish(input.sideQuestionId, outcome);
      const finished = db.getById(input.sideQuestionId);
      if (!finished) {
        return;
      }

      notify({
        kind: 'side_question',
        sessionId: input.sessionId,
        sideQuestionId: input.sideQuestionId,
        phase: outcome.status === 'done' ? 'done' : 'error',
        error: outcome.status === 'error' ? outcome.error : undefined,
        sideQuestion: toSideQuestion(finished),
        timestamp: new Date().toISOString(),
      });
    } finally {
      controllers.delete(input.sideQuestionId);
    }
  }

  /** The session's whole side-question list, oldest first, for the history route. */
  function listForSession(sessionId: string): SideQuestion[] {
    return db.listForSession(sessionId).map(toSideQuestion);
  }

  /**
   * Aborts a side question if it is still running, then deletes its row.
   * Returns whether a row actually went, so the route can answer 404 or 200.
   *
   * Looks the row up by id first: a hit that belongs to another session is
   * left completely alone (not aborted, not deleted) and reported as if it
   * did not exist, so one session can never stop or erase another's
   * question just by guessing its id.
   *
   * `notify`, when given, is told about a successful dismiss (`phase:
   * 'dismissed'`) so every connected client — not just the asker — drops the
   * id instead of leaving it pending until a full reload.
   */
  function dismiss(
    sessionId: string,
    id: string,
    notify?: (event: SideQuestionEvent) => void,
  ): boolean {
    const row = db.getById(id);
    if (!row || row.session_id !== sessionId) {
      return false;
    }

    controllers.get(id)?.abort();
    const deleted = db.delete(sessionId, id);
    if (deleted) {
      notify?.({
        kind: 'side_question',
        sessionId,
        sideQuestionId: id,
        phase: 'dismissed',
        timestamp: new Date().toISOString(),
      });
    }
    return deleted;
  }

  /**
   * Fails every row left `running` by a dead process. Called once at startup
   * (`server/index.ts`, after the database is initialised) so a side question
   * interrupted by a restart reads as failed instead of pending forever.
   */
  function recoverInterrupted(): number {
    return db.failRunning('Interrupted: the server restarted before the answer finished.');
  }

  return { ask, listForSession, dismiss, recoverInterrupted };
}

/** Default instance, consumed through `@/modules/providers/index.js`. */
export const sideQuestionsService = createSideQuestionsService();
