import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Options } from '@anthropic-ai/claude-agent-sdk';

import type { SideQuestionInput, SideQuestionResult } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

// The SDK implements this native control request but currently omits it from
// Query's public declarations. Keep that compatibility detail at this boundary.
type SideQuestionQuery = AsyncIterable<unknown> & {
  askSideQuestion?: (
    question: string,
    options: { history: SideQuestionInput['history']; signal: AbortSignal },
  ) => Promise<SideQuestionResult | null>;
  initializationResult(): Promise<unknown>;
  close(): void;
};

type LiveQuery = {
  instance: SideQuestionQuery;
  pending: Set<Promise<unknown>>;
  closing: boolean;
};

/** Used by Claude's runtime and its tests to dispatch the CLI's native /btw request. */
export class ClaudeSideQuestions {
  private readonly live = new Map<string, LiveQuery>();

  constructor(private readonly createQuery = (options: Options, prompt: AsyncIterable<never>) =>
    query({ options, prompt }) as SideQuestionQuery) {}

  /** The main runtime registers its actual Query and defers EOF until side requests settle. */
  register(sessionId: string, instance: SideQuestionQuery, releaseInput: () => void) {
    const entry: LiveQuery = { instance, pending: new Set(), closing: false };
    this.live.set(sessionId, entry);
    return {
      release: () => {
        if (entry.closing) return;
        entry.closing = true;
        if (entry.pending.size === 0) releaseInput();
        else void Promise.allSettled([...entry.pending]).then(releaseInput);
      },
      dispose: () => {
        if (this.live.get(sessionId) === entry) this.live.delete(sessionId);
      },
    };
  }

  /** Active sessions share the live worker. Idle sessions resume natively with no user input. */
  async ask(
    sessionId: string,
    input: SideQuestionInput,
    createOptions: () => Promise<Options>,
    signal: AbortSignal,
  ): Promise<SideQuestionResult> {
    signal.throwIfAborted();
    const entry = this.live.get(sessionId);
    if (entry && !entry.closing) {
      const pending = this.request(entry.instance, input, signal);
      entry.pending.add(pending);
      try { return await pending; }
      finally { entry.pending.delete(pending); }
    }

    const options = await createOptions();
    signal.throwIfAborted();
    if (!options.resume) {
      throw new AppError('Start a Claude conversation before asking a side question.', {
        code: 'SIDE_QUESTION_NO_CONTEXT', statusCode: 409,
      });
    }
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const prompt: AsyncIterable<never> = {
      [Symbol.asyncIterator]: () => ({ next: async () => { await held; return { done: true, value: undefined }; } }),
    };
    const instance = this.createQuery({ ...options, persistSession: false }, prompt);
    // A Query must be consumed while control requests run. Keep all of these
    // events local, outside CloudCLI's main transcript and run registry.
    const drain = (async () => { for await (const _message of instance) { /* control-only worker */ } })();
    // Attach a rejection handler immediately, including during initialization.
    const finished = drain.catch(() => {});
    const close = () => { release(); instance.close(); };
    signal.addEventListener('abort', close, { once: true });
    try {
      await instance.initializationResult();
      return await this.request(instance, input, signal);
    } finally {
      signal.removeEventListener('abort', close);
      close();
      await finished;
    }
  }

  private async request(instance: SideQuestionQuery, input: SideQuestionInput, signal: AbortSignal) {
    if (typeof instance.askSideQuestion !== 'function') {
      throw new AppError('This Claude Agent SDK does not support native side questions. Update Claude Code and the SDK.', {
        code: 'SIDE_QUESTION_UNSUPPORTED', statusCode: 409,
      });
    }
    const result = await instance.askSideQuestion(input.question, { history: input.history, signal });
    if (!result) {
      throw new AppError('Claude has no conversation context for this side question yet.', {
        code: 'SIDE_QUESTION_NO_CONTEXT', statusCode: 409,
      });
    }
    return result;
  }
}

/** Shared by the Claude runtime's run and side-question entry points. */
export const claudeSideQuestions = new ClaudeSideQuestions();
