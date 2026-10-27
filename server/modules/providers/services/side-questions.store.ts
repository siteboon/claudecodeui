import type { SideQuestion, SideQuestionOutcome } from '@/shared/types.js';

/**
 * The one place a side question's mutable state lives.
 *
 * It holds `SideQuestion` objects — the camelCase wire shape from
 * `server/shared/types.ts` — directly, so the service, the history route and
 * the websocket handler all read and write the same object and no
 * row-to-wire mapping is needed. Side questions are deliberately in memory
 * only: a CloudCLI restart is a clean slate, and `createdAt`/`finishedAt` are
 * ISO strings, not database timestamps.
 */
export type InMemorySideQuestionsStore = {
  /** Inserts a fresh question as `running` and returns it. */
  create(input: {
    id: string;
    sessionId: string;
    question: string;
    model: string | null;
  }): SideQuestion;
  /** The whole question, whatever its status, or null once deleted. */
  getById(id: string): SideQuestion | null;
  /** Appends streamed text to the answer; a no-op once deleted. */
  appendAnswer(id: string, text: string): void;
  /** Settles a running question; a no-op once deleted. */
  finish(id: string, outcome: SideQuestionOutcome): void;
  /** The session's questions, oldest first. */
  listForSession(sessionId: string): SideQuestion[];
  /** Deletes one question of one session. Reports whether anything went. */
  delete(sessionId: string, id: string): boolean;
};

/**
 * Builds the default in-memory store. Each service instance creates its own,
 * so a new service instance starts empty — the in-memory shape of a restart.
 */
export function createInMemorySideQuestionsStore(): InMemorySideQuestionsStore {
  const questions = new Map<string, SideQuestion>();

  return {
    create({ id, sessionId, question, model }) {
      const now = new Date().toISOString();
      const sideQuestion: SideQuestion = {
        id,
        sessionId,
        question,
        answer: '',
        status: 'running',
        error: null,
        model,
        createdAt: now,
        finishedAt: null,
      };
      questions.set(id, sideQuestion);
      return sideQuestion;
    },

    getById(id) {
      return questions.get(id) ?? null;
    },

    appendAnswer(id, text) {
      const sideQuestion = questions.get(id);
      if (sideQuestion) {
        sideQuestion.answer += text;
      }
    },

    finish(id, outcome) {
      const sideQuestion = questions.get(id);
      if (!sideQuestion) {
        return;
      }
      sideQuestion.status = outcome.status;
      sideQuestion.answer = outcome.answer;
      sideQuestion.error = outcome.status === 'error' ? outcome.error : null;
      sideQuestion.finishedAt = new Date().toISOString();
    },

    listForSession(sessionId) {
      const list = [...questions.values()].filter((item) => item.sessionId === sessionId);
      // `createdAt` is ISO, so string order is time order. The Map insertion
      // order already is, but the sort keeps the contract visible at the one
      // place "oldest first" is promised.
      return list.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
    },

    delete(sessionId, id) {
      const sideQuestion = questions.get(id);
      if (sideQuestion && sideQuestion.sessionId === sessionId) {
        questions.delete(id);
        return true;
      }
      return false;
    },
  };
}
