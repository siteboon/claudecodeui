import fs from 'node:fs';
import os from 'node:os';

import { query } from '@anthropic-ai/claude-agent-sdk';

import { sessionsDb } from '@/modules/database/index.js';
import { filterAttachmentsToUploadStore } from '@/modules/websocket/index.js';
import { resolveClaudeCodeExecutablePath } from '@/shared/claude-cli-path.js';
import { buildClaudeUserContent, isImageAttachmentDescriptor } from '@/shared/image-attachments.js';
import { AppError } from '@/shared/utils.js';

type SessionRow = NonNullable<ReturnType<typeof sessionsDb.getSessionById>>;

type SideQuestionQuery = AsyncIterable<Record<string, any>> & {
  interrupt?: () => Promise<unknown>;
};

/** One earlier question and answer of the same side chat. */
export type SideChatExchange = {
  question: string;
  answer: string;
};

type ClaudeSideQuestionServiceDependencies = {
  createQuery: (params: { prompt: AsyncIterable<unknown>; options: Record<string, unknown> }) => SideQuestionQuery;
  getSessionById: (sessionId: string) => SessionRow | null | undefined;
  isDirectory: (directoryPath: string) => boolean;
};

// A side question gets one short answer; a model that hangs must not hold the request.
const TIMEOUT_MS = 2 * 60 * 1000;

const SIDE_QUESTION_PREFIX = [
  'The user opened a side chat with /btw to ask about this conversation.',
  'Answer briefly from what you already know of it.',
  'You have no tools here, and the side chat is not added to the conversation.',
].join('\n');

// Earlier turns of the side chat travel with each question, since none is saved.
const MAX_HISTORY = 20;

const buildSideChatPrompt = (history: SideChatExchange[], question: string): string => {
  const parts = [SIDE_QUESTION_PREFIX];
  const earlier = history.slice(-MAX_HISTORY);
  if (earlier.length > 0) {
    parts.push('', 'Earlier in this side chat:');
    for (const exchange of earlier) {
      parts.push(`User: ${exchange.question}`, `You: ${exchange.answer}`);
    }
  }
  parts.push('', 'Side question:', question);
  return parts.join('\n');
};

const isDirectory = (directoryPath: string): boolean => {
  try {
    return fs.statSync(directoryPath).isDirectory();
  } catch {
    return false;
  }
};

/**
 * `/btw`: the CLI offers it only in its terminal UI. This answers a side-chat
 * question from a fork of the session that is never written to disk, with no
 * tools and one turn, so the conversation itself does not change — and it can
 * run while the session's own turn is still going. The side chat's earlier
 * questions and answers come with each request, since nothing of it is saved.
 */
export function createClaudeSideQuestionService(dependencies: ClaudeSideQuestionServiceDependencies = {
  createQuery: (params) => query(params as never) as unknown as SideQuestionQuery,
  getSessionById: (sessionId) => sessionsDb.getSessionById(sessionId),
  isDirectory,
}) {
  return {
    async ask(input: {
      sessionId?: string | null;
      question: string;
      model?: string | null;
      effort?: string | null;
      history?: SideChatExchange[];
      attachments?: unknown;
      signal?: AbortSignal;
    }): Promise<{ answer: string }> {
      const question = input.question.trim();
      if (!question) {
        throw new AppError('A side question needs some text after /btw.', { code: 'QUESTION_REQUIRED', statusCode: 400 });
      }

      const session = input.sessionId ? dependencies.getSessionById(input.sessionId) : null;
      if (input.sessionId && !session) {
        throw new AppError(`Session "${input.sessionId}" was not found.`, { code: 'SESSION_NOT_FOUND', statusCode: 404 });
      }

      const cwd = session?.project_path && dependencies.isDirectory(session.project_path)
        ? session.project_path
        : os.homedir();
      const options: Record<string, unknown> = {
        cwd,
        tools: [],
        maxTurns: 1,
        persistSession: false,
      };
      // Without a provider id the chat has no turns yet, so there is no context to fork.
      if (session?.provider_session_id) {
        options.resume = session.provider_session_id;
        options.forkSession = true;
      }
      const model = input.model && input.model !== 'default' ? input.model : session?.model;
      if (model) {
        options.model = model;
      }
      if (input.effort) {
        options.effort = input.effort;
      }
      // Stop in the side chat (or a closed tab) ends the CLI process.
      const abortController = new AbortController();
      if (input.signal) {
        if (input.signal.aborted) {
          abortController.abort();
        }
        input.signal.addEventListener('abort', () => abortController.abort(), { once: true });
      }
      options.abortController = abortController;
      const executable = resolveClaudeCodeExecutablePath(process.env.CLAUDE_CLI_PATH);
      if (executable) {
        options.pathToClaudeCodeExecutable = executable;
      }

      // Pictures go in as image blocks, from the upload store only (as in chat.send).
      const images = filterAttachmentsToUploadStore(input.attachments).filter(isImageAttachmentDescriptor);
      const text = buildSideChatPrompt(input.history ?? [], question);
      const content = images.length > 0 ? await buildClaudeUserContent(text, images, cwd) : text;
      // The input stays open until the answer's `result`: a stream that ends at
      // once closes the CLI's stdin before it has answered.
      let finishInput = () => {};
      const inputDone = new Promise<void>((resolve) => { finishInput = resolve; });
      abortController.signal.addEventListener('abort', () => finishInput(), { once: true });
      const prompt = (async function* () {
        yield { type: 'user', message: { role: 'user', content }, parent_tool_use_id: null };
        await inputDone;
      })();

      const instance = dependencies.createQuery({ prompt, options });
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        abortController.abort();
      }, TIMEOUT_MS);
      timer.unref?.();

      const parts: string[] = [];
      let failure: string | null = null;
      try {
        for await (const message of instance) {
          if (message.type === 'assistant' && !message.parent_tool_use_id && Array.isArray(message.message?.content)) {
            for (const block of message.message.content) {
              if (block?.type === 'text' && typeof block.text === 'string') {
                parts.push(block.text);
              }
            }
          }
          if (message.type === 'result') {
            if (message.subtype !== 'success' && parts.length === 0) {
              failure = Array.isArray(message.errors) && message.errors.length > 0
                ? String(message.errors[0])
                : `The side question ended with ${message.subtype}.`;
            }
            finishInput();
          }
        }
      } catch (error) {
        // An abort ends the stream with an error; anything else is a real failure.
        if (!abortController.signal.aborted) {
          throw error;
        }
      } finally {
        clearTimeout(timer);
        finishInput();
      }

      if (input.signal?.aborted) {
        throw new AppError('The side question was stopped.', { code: 'STOPPED', statusCode: 499 });
      }
      if (timedOut) {
        throw new AppError('The side question took too long and was stopped.', { code: 'TIMEOUT', statusCode: 504 });
      }

      const answer = parts.join('\n\n').trim();
      if (!answer) {
        throw new AppError(failure ?? 'No answer came back for the side question.', { code: 'NO_ANSWER', statusCode: 502 });
      }
      return { answer };
    },
  };
}

export const claudeSideQuestionService = createClaudeSideQuestionService();
