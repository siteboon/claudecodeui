import type { InMemorySideQuestionsStore, SideQuestion } from '@/shared/types.js';

/**
 * Builds the default in-memory store. Each service instance creates its own,
 * so a new service instance starts empty — the in-memory shape of a restart.
 *
 * Used by `side-questions.service.ts`, the only consumer: a fresh default
 * when the service is built without an injected `store` (tests inject their
 * own fake instead).
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
