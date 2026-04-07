import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';

import spawn from 'cross-spawn';
import TOML from '@iarna/toml';

import type { ProviderMcpServer } from '@/modules/ai-runtime/types/index.js';
import { AppError } from '@/shared/utils/app-error.js';

/**
 * Resolves workspace paths once so all scope loaders read from a consistent absolute root.
 */
export const resolveWorkspacePath = (workspacePath?: string): string =>
  path.resolve(workspacePath ?? process.cwd());

/**
 * Restricts MCP server names to non-empty trimmed strings.
 */
export const normalizeServerName = (name: string): string => {
  const normalized = name.trim();
  if (!normalized) {
    throw new AppError('MCP server name is required.', {
      code: 'MCP_SERVER_NAME_REQUIRED',
      statusCode: 400,
    });
  }

  return normalized;
};

/**
 * Reads plain object records.
 */
export const readObjectRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

/**
 * Reads optional strings.
 */
export const readOptionalString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length ? normalized : undefined;
};

/**
 * Reads optional string arrays.
 */
export const readStringArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.filter((entry): entry is string => typeof entry === 'string');
};

/**
 * Reads optional string maps.
 */
export const readStringRecord = (value: unknown): Record<string, string> | undefined => {
  const record = readObjectRecord(value);
  if (!record) {
    return undefined;
  }

  const normalized: Record<string, string> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry === 'string') {
      normalized[key] = entry;
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
};

/**
 * Safely reads a JSON config file and returns an empty object when missing.
 */
export const readJsonConfig = async (filePath: string): Promise<Record<string, unknown>> => {
  try {
    const content = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(content) as Record<string, unknown>;
    return readObjectRecord(parsed) ?? {};
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return {};
    }
    throw error;
  }
};

/**
 * Writes one JSON config with stable formatting.
 */
export const writeJsonConfig = async (filePath: string, data: Record<string, unknown>): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
};

/**
 * Safely reads a TOML config and returns an empty object when missing.
 */
export const readTomlConfig = async (filePath: string): Promise<Record<string, unknown>> => {
  try {
    const content = await readFile(filePath, 'utf8');
    const parsed = TOML.parse(content) as Record<string, unknown>;
    return readObjectRecord(parsed) ?? {};
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return {};
    }
    throw error;
  }
};

/**
 * Writes one TOML config file.
 */
export const writeTomlConfig = async (filePath: string, data: Record<string, unknown>): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true });
  const toml = TOML.stringify(data as any);
  await writeFile(filePath, toml, 'utf8');
};

/**
 * Runs a short stdio process startup probe.
 */
export const runStdioServerProbe = async (
  server: ProviderMcpServer,
  workspacePath: string,
): Promise<{ reachable: boolean; error?: string }> => {
  if (!server.command) {
    return { reachable: false, error: 'Missing stdio command.' };
  }

  try {
    const child = spawn(server.command, server.args ?? [], {
      cwd: server.cwd ? path.resolve(workspacePath, server.cwd) : workspacePath,
      env: {
        ...process.env,
        ...(server.env ?? {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timeout = setTimeout(() => {
      if (!child.killed && child.exitCode === null) {
        child.kill('SIGTERM');
      }
    }, 1_500);

    const errorPromise = once(child, 'error').then(([error]) => {
      throw error;
    });
    const closePromise = once(child, 'close');
    await Promise.race([closePromise, errorPromise]);
    clearTimeout(timeout);

    if (typeof child.exitCode === 'number' && child.exitCode !== 0) {
      return {
        reachable: false,
        error: `Process exited with code ${child.exitCode}.`,
      };
    }

    return { reachable: true };
  } catch (error) {
    return {
      reachable: false,
      error: error instanceof Error ? error.message : 'Failed to start stdio process',
    };
  }
};

/**
 * Runs a lightweight HTTP/SSE reachability probe.
 */
export const runHttpServerProbe = async (
  url: string,
): Promise<{ reachable: boolean; statusCode?: number; error?: string }> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await fetch(url, { method: 'GET', signal: controller.signal });
    clearTimeout(timeout);
    return {
      reachable: true,
      statusCode: response.status,
    };
  } catch (error) {
    clearTimeout(timeout);
    return {
      reachable: false,
      error: error instanceof Error ? error.message : 'Network probe failed',
    };
  }
};
