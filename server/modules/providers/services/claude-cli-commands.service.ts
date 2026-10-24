import fs from 'node:fs';
import os from 'node:os';

import { query } from '@anthropic-ai/claude-agent-sdk';

import { resolveClaudeCodeExecutablePath } from '@/shared/claude-cli-path.js';

/** One slash command the Claude Code CLI runs when it is sent as a message. */
export type ClaudeCliCommand = {
  name: string;
  description: string;
  argumentHint: string;
  aliases: string[];
  builtin: boolean;
};

type RawCommand = {
  name?: string;
  description?: string;
  argumentHint?: string;
  aliases?: string[];
  builtin?: boolean;
};

type CommandsQuery = AsyncIterable<unknown> & {
  supportedCommands?: () => Promise<RawCommand[]>;
};

type ClaudeCliCommandsServiceDependencies = {
  createQuery: (params: { prompt: AsyncIterable<never>; options: Record<string, unknown> }) => CommandsQuery;
  now: () => number;
  isDirectory: (directoryPath: string) => boolean;
};

// The list only changes when skills, plugins or the CLI itself change.
const CACHE_MS = 10 * 60 * 1000;

const isDirectory = (directoryPath: string): boolean => {
  try {
    return fs.statSync(directoryPath).isDirectory();
  } catch {
    return false;
  }
};

export function createClaudeCliCommandsService(dependencies: ClaudeCliCommandsServiceDependencies = {
  createQuery: (params) => query(params as never) as unknown as CommandsQuery,
  now: () => Date.now(),
  isDirectory,
}) {
  const cache = new Map<string, { commands: ClaudeCliCommand[]; at: number }>();
  const inFlight = new Map<string, Promise<ClaudeCliCommand[]>>();

  // Starts the CLI in the workspace (so its project skills and commands count)
  // with an input stream that sends nothing, asks for the command list, then
  // closes stdin so the process exits.
  const read = async (cwd: string): Promise<ClaudeCliCommand[]> => {
    let release = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    const prompt: AsyncIterable<never> = {
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          await held;
          return { done: true, value: undefined as never };
        },
      }),
    };

    const options: Record<string, unknown> = { cwd };
    const executable = resolveClaudeCodeExecutablePath(process.env.CLAUDE_CLI_PATH);
    if (executable) {
      options.pathToClaudeCodeExecutable = executable;
    }

    const instance = dependencies.createQuery({ prompt, options });
    try {
      if (typeof instance.supportedCommands !== 'function') {
        return [];
      }
      const raw = await instance.supportedCommands();
      return raw
        // Names starting with "_" are the CLI's internal plumbing.
        .filter((command) => typeof command.name === 'string' && command.name && !command.name.startsWith('_'))
        .map((command) => ({
          name: `/${command.name}`,
          description: command.description ?? '',
          argumentHint: command.argumentHint ?? '',
          aliases: (command.aliases ?? []).map((alias) => `/${alias}`),
          builtin: command.builtin === true,
        }));
    } finally {
      release();
      // Drain so the process winds down instead of lingering.
      void (async () => {
        try {
          for await (const _message of instance) { /* discard */ }
        } catch {
          // A process that exits on closed stdin may end its stream with an error.
        }
      })();
    }
  };

  return {
    async listCommands(workspacePath?: string): Promise<ClaudeCliCommand[]> {
      const cwd = workspacePath && dependencies.isDirectory(workspacePath) ? workspacePath : os.homedir();
      const cached = cache.get(cwd);
      if (cached && dependencies.now() - cached.at < CACHE_MS) {
        return cached.commands;
      }
      let pending = inFlight.get(cwd);
      if (!pending) {
        pending = read(cwd)
          .then((commands) => {
            cache.set(cwd, { commands, at: dependencies.now() });
            return commands;
          })
          .finally(() => { inFlight.delete(cwd); });
        inFlight.set(cwd, pending);
      }
      return pending;
    },
  };
}

export const claudeCliCommandsService = createClaudeCliCommandsService();
