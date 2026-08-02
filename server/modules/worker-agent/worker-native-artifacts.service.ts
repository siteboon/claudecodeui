import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { LLMProvider, NormalizedMessage } from '@/shared/types.js';

type NativeArtifactsDependencies = {
  getHomeDirectory: () => string;
  fileExists: (filePath: string) => boolean;
  readDirectory: (directoryPath: string) => Promise<string[]>;
  mkdir: (directoryPath: string) => Promise<void>;
  writeTextFile: (filePath: string, contents: string) => Promise<void>;
  now: () => Date;
};

const defaultDependencies: NativeArtifactsDependencies = {
  getHomeDirectory: () => os.homedir(),
  fileExists: (filePath) => fs.existsSync(filePath),
  readDirectory: async (directoryPath) => {
    const entries = await fsp.readdir(directoryPath, { withFileTypes: true });
    return entries.map((entry) => path.join(directoryPath, entry.name));
  },
  mkdir: async (directoryPath) => {
    await fsp.mkdir(directoryPath, { recursive: true });
  },
  writeTextFile: (filePath, contents) => fsp.writeFile(filePath, contents, 'utf8'),
  now: () => new Date(),
};

export type EnsureNativeResult = {
  success: boolean;
  jsonlPath: string | null;
  restored: boolean;
  dropProviderSessionId?: boolean;
  error?: string;
};

function encodeClaudeProjectPath(projectPath: string): string {
  return projectPath.replace(/[^a-zA-Z0-9-]/g, '-');
}

function extractTextTurns(messages: NormalizedMessage[]): Array<{
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  id: string;
}> {
  const turns: Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp: string;
    id: string;
  }> = [];

  for (const message of messages) {
    const content = typeof message.content === 'string' ? message.content.trim() : '';
    if (!content) {
      continue;
    }
    if (message.role !== 'user' && message.role !== 'assistant') {
      continue;
    }
    turns.push({
      role: message.role,
      content,
      timestamp: message.timestamp || new Date().toISOString(),
      id: message.id || crypto.randomUUID(),
    });
  }

  return turns;
}

async function findCodexSessionFile(
  directoryPath: string,
  providerSessionId: string,
  dependencies: NativeArtifactsDependencies,
): Promise<string | null> {
  let entries: string[];
  try {
    entries = await dependencies.readDirectory(directoryPath);
  } catch {
    return null;
  }

  for (const entryPath of entries) {
    let isDirectory = false;
    try {
      isDirectory = (await fsp.stat(entryPath)).isDirectory();
    } catch {
      continue;
    }

    if (isDirectory) {
      const nested = await findCodexSessionFile(entryPath, providerSessionId, dependencies);
      if (nested) {
        return nested;
      }
      continue;
    }

    const baseName = path.basename(entryPath);
    if (baseName.includes(providerSessionId) && baseName.endsWith('.jsonl')) {
      return entryPath;
    }
  }

  return null;
}

/**
 * Creates Worker-local helpers that locate and (best-effort) restore provider
 * native session artifacts so the same-machine CLI can resume web chats.
 *
 * Used by the worker chat runner and `session.ensure_native` handling.
 */
export function createWorkerNativeArtifactsService(
  dependencyOverrides: Partial<NativeArtifactsDependencies> = {},
) {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides };

  const resolveClaudePath = (providerSessionId: string, projectPath: string | null): string | null => {
    if (!projectPath) {
      return null;
    }
    const encoded = encodeClaudeProjectPath(projectPath);
    return path.join(
      dependencies.getHomeDirectory(),
      '.claude',
      'projects',
      encoded,
      `${providerSessionId}.jsonl`,
    );
  };

  const resolveCursorStorePath = (providerSessionId: string, projectPath: string | null): string | null => {
    const cwd = projectPath || process.cwd();
    const cwdId = crypto.createHash('md5').update(cwd).digest('hex');
    return path.join(
      dependencies.getHomeDirectory(),
      '.cursor',
      'chats',
      cwdId,
      providerSessionId,
      'store.db',
    );
  };

  return {
    /**
     * Resolves an existing on-disk path for a provider-native session, or null
     * when the artifact is missing / layout cannot be discovered yet.
     */
    async resolveNativePath(
      provider: LLMProvider,
      providerSessionId: string,
      projectPath: string | null,
    ): Promise<string | null> {
      if (provider === 'claude') {
        const candidate = resolveClaudePath(providerSessionId, projectPath);
        if (candidate && dependencies.fileExists(candidate)) {
          return candidate;
        }
        return null;
      }

      if (provider === 'codex') {
        return findCodexSessionFile(
          path.join(dependencies.getHomeDirectory(), '.codex', 'sessions'),
          providerSessionId,
          dependencies,
        );
      }

      if (provider === 'cursor') {
        const storePath = resolveCursorStorePath(providerSessionId, projectPath);
        if (storePath && dependencies.fileExists(storePath)) {
          return storePath;
        }
        return null;
      }

      return null;
    },

    /**
     * Ensures local native artifacts exist for resume. When missing, writes a
     * best-effort Claude/Codex transcript from cloud-normalized turns. Cursor
     * store.db cannot be reconstructed; missing Cursor artifacts ask the Server
     * to drop the native id so the next run starts fresh.
     */
    async ensureNative(input: {
      provider: LLMProvider;
      providerSessionId: string | null;
      projectPath: string | null;
      messages?: NormalizedMessage[];
    }): Promise<EnsureNativeResult> {
      const { provider, providerSessionId, projectPath } = input;
      if (!providerSessionId) {
        return { success: true, jsonlPath: null, restored: false };
      }

      if (provider === 'claude') {
        const targetPath = resolveClaudePath(providerSessionId, projectPath);
        if (!targetPath) {
          return {
            success: false,
            jsonlPath: null,
            restored: false,
            error: 'Claude ensure_native requires projectPath',
          };
        }
        if (dependencies.fileExists(targetPath)) {
          return { success: true, jsonlPath: targetPath, restored: false };
        }

        const cwd = projectPath || process.cwd();
        const turns = extractTextTurns(input.messages ?? []);
        const lines = turns.map((turn) => JSON.stringify({
          type: turn.role,
          uuid: turn.id,
          sessionId: providerSessionId,
          cwd,
          timestamp: turn.timestamp,
          message: {
            role: turn.role,
            content: [{ type: 'text', text: turn.content }],
          },
        }));

        if (lines.length === 0) {
          lines.push(JSON.stringify({
            type: 'user',
            uuid: crypto.randomUUID(),
            sessionId: providerSessionId,
            cwd,
            timestamp: dependencies.now().toISOString(),
            message: {
              role: 'user',
              content: [{ type: 'text', text: '[cloudcli] Restored empty session shell for native resume' }],
            },
          }));
        }

        await dependencies.mkdir(path.dirname(targetPath));
        await dependencies.writeTextFile(targetPath, `${lines.join('\n')}\n`);
        return { success: true, jsonlPath: targetPath, restored: true };
      }

      if (provider === 'codex') {
        const existing = await findCodexSessionFile(
          path.join(dependencies.getHomeDirectory(), '.codex', 'sessions'),
          providerSessionId,
          dependencies,
        );
        if (existing) {
          return { success: true, jsonlPath: existing, restored: false };
        }

        const now = dependencies.now();
        const year = String(now.getUTCFullYear());
        const month = String(now.getUTCMonth() + 1).padStart(2, '0');
        const day = String(now.getUTCDate()).padStart(2, '0');
        const sessionsDir = path.join(
          dependencies.getHomeDirectory(),
          '.codex',
          'sessions',
          year,
          month,
          day,
        );
        const targetPath = path.join(sessionsDir, `rollout-${providerSessionId}.jsonl`);
        const cwd = projectPath || process.cwd();
        const turns = extractTextTurns(input.messages ?? []);
        const lines = [
          JSON.stringify({
            type: 'session_meta',
            payload: { id: providerSessionId, cwd },
          }),
        ];
        for (const turn of turns) {
          if (turn.role === 'user') {
            lines.push(JSON.stringify({
              type: 'event_msg',
              payload: { type: 'user_message', message: turn.content },
            }));
          } else {
            lines.push(JSON.stringify({
              type: 'event_msg',
              payload: { type: 'agent_message', message: turn.content },
            }));
          }
        }

        await dependencies.mkdir(sessionsDir);
        await dependencies.writeTextFile(targetPath, `${lines.join('\n')}\n`);
        return { success: true, jsonlPath: targetPath, restored: true };
      }

      if (provider === 'cursor') {
        const storePath = resolveCursorStorePath(providerSessionId, projectPath);
        if (storePath && dependencies.fileExists(storePath)) {
          return { success: true, jsonlPath: storePath, restored: false };
        }
        return {
          success: true,
          jsonlPath: null,
          restored: false,
          dropProviderSessionId: true,
          error: 'Cursor store.db rewrite is not supported; next run starts a fresh native session',
        };
      }

      // OpenCode and unknown providers: nothing filesystem-shaped to restore.
      return { success: true, jsonlPath: null, restored: false };
    },
  };
}

export type WorkerNativeArtifactsService = ReturnType<typeof createWorkerNativeArtifactsService>;
