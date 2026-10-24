import fs from 'node:fs';
import os from 'node:os';

import { query } from '@anthropic-ai/claude-agent-sdk';

import { sessionsDb } from '@/modules/database/index.js';
import { resolveClaudeCodeExecutablePath } from '@/shared/claude-cli-path.js';
import { AppError } from '@/shared/utils.js';

type SessionRow = NonNullable<ReturnType<typeof sessionsDb.getSessionById>>;

type SideQuestionQuery = AsyncIterable<Record<string, any>> & {
  interrupt?: () => Promise<unknown>;
};

type ClaudeSideQuestionServiceDependencies = {
  createQuery: (params: { prompt: string; options: Record<string, unknown> }) => SideQuestionQuery;
  getSessionById: (sessionId: string) => SessionRow | null | undefined;
  isDirectory: (directoryPath: string) => boolean;
};

// A side question gets one short answer; a model that hangs must not hold the request.
const TIMEOUT_MS = 2 * 60 * 1000;

const SIDE_QUESTION_PREFIX = [
  'The user asked a quick side question with /btw.',
  'Answer it briefly from what you already know of this conversation.',
  'You have no tools for this answer, and this exchange is not added to the conversation.',
  '',
  'Side question:',
].join('\n');

const isDirectory = (directoryPath: string): boolean => {
  try {
    return fs.statSync(directoryPath).isDirectory();
  } catch {
    return false;
  }
};

/**
 * `/btw`: the CLI offers it only in its terminal UI. This answers the question
 * from a fork of the session that is never written to disk, with no tools and
 * one turn, so the conversation itself does not change — and it can run while
 * the session's own turn is still going.
 */
export function createClaudeSideQuestionService(dependencies: ClaudeSideQuestionServiceDependencies = {
  createQuery: (params) => query(params as never) as unknown as SideQuestionQuery,
  getSessionById: (sessionId) => sessionsDb.getSessionById(sessionId),
  isDirectory,
}) {
  return {
    async ask(input: { sessionId?: string | null; question: string; model?: string | null }): Promise<{ answer: string }> {
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
      const executable = resolveClaudeCodeExecutablePath(process.env.CLAUDE_CLI_PATH);
      if (executable) {
        options.pathToClaudeCodeExecutable = executable;
      }

      const instance = dependencies.createQuery({ prompt: `${SIDE_QUESTION_PREFIX}\n${question}`, options });
      const timer = setTimeout(() => { void instance.interrupt?.().catch(() => {}); }, TIMEOUT_MS);
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
          if (message.type === 'result' && message.subtype !== 'success' && parts.length === 0) {
            failure = Array.isArray(message.errors) && message.errors.length > 0
              ? String(message.errors[0])
              : `The side question ended with ${message.subtype}.`;
          }
        }
      } finally {
        clearTimeout(timer);
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
