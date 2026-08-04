import fsSync from 'node:fs';
import path from 'node:path';

import crossSpawn from 'cross-spawn';

import { sessionsDb } from '@/modules/database/index.js';
import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderCurrentActiveModel,
  ProviderModelsDefinition,
} from '@/shared/types.js';
import {
  buildDefaultProviderCurrentActiveModel,
  encodeQoderCwd,
  getQoderProjectsDir,
  readJsonRecord,
  readOptionalString,
  unwrapJsonStringLiteral,
} from '@/shared/utils.js';

export const QODER_FALLBACK_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    {
      value: 'Auto',
      label: 'Auto',
      description: 'Qoder - Auto',
    },
    {
      value: 'Ultimate',
      label: 'Ultimate',
      description: 'Qoder - Ultimate',
    },
    {
      value: 'Performance',
      label: 'Performance',
      description: 'Qoder - Performance',
    },
    {
      value: 'Efficient',
      label: 'Efficient',
      description: 'Qoder - Efficient',
    },
    {
      value: 'Lite',
      label: 'Lite',
      description: 'Qoder - Lite',
    },
    {
      value: 'Cantus',
      label: 'Cantus',
      description: 'Qoder - Cantus',
    },
  ],
  DEFAULT: 'Auto',
};

const QODER_MODELS_TIMEOUT_MS = 20_000;

const runQoderModelsCommand = (): Promise<string> => new Promise((resolve, reject) => {
  const qoderProcess = crossSpawn('qodercli', ['--list-models'], {
    cwd: process.cwd(),
    env: { ...process.env },
  });

  let stdout = '';
  let stderr = '';
  let settled = false;

  const timer = setTimeout(() => {
    qoderProcess.kill('SIGTERM');
    if (!settled) {
      settled = true;
      reject(new Error('qodercli --list-models timed out'));
    }
  }, QODER_MODELS_TIMEOUT_MS);

  const finish = (error: Error | null, output: string) => {
    if (settled) {
      return;
    }

    settled = true;
    clearTimeout(timer);

    if (error) {
      reject(error);
      return;
    }

    resolve(output);
  };

  qoderProcess.stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
  });

  qoderProcess.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  qoderProcess.on('error', (error) => {
    finish(error instanceof Error ? error : new Error(String(error)), '');
  });

  qoderProcess.on('close', (code) => {
    if (code !== 0) {
      finish(new Error(stderr.trim() || `qodercli --list-models exited with code ${code}`), '');
      return;
    }

    finish(null, stdout);
  });
});

export const parseQoderModelsStdout = (stdout: string): string[] => {
  const ids: string[] = [];

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    // `qodercli --list-models` prints a literal `MODEL` header row before the
    // model ids. It must not surface as a selectable model — picking it would
    // pass `-m MODEL` and qodercli rejects it with exit 42 ("Invalid model").
    if (
      !line
      || line === 'MODEL'
      || line.startsWith('{')
      || line.startsWith('[')
    ) {
      continue;
    }

    ids.push(line);
  }

  return [...new Set(ids)];
};

/**
 * Reads the model Qoder recorded for one session from its transcript.
 *
 * Qoder writes a `runtime-config` row at session start carrying the resolved
 * model name (for example `auto`), and every assistant message repeats the
 * model on `message.model`. The last non-empty value wins so a model switch
 * mid-session is reflected.
 */
const readQoderSessionModel = (jsonlPath: string): string | null => {
  if (!fsSync.existsSync(jsonlPath)) {
    return null;
  }

  try {
    const content = fsSync.readFileSync(jsonlPath, 'utf8');
    let model: string | null = null;

    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }

      let entry: unknown;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }

      const data = readJsonRecord(entry);
      if (!data) {
        continue;
      }

      const entryType = readOptionalString(data.type);
      if (entryType === 'runtime-config') {
        const runtimeModel = readOptionalString(data.model);
        if (runtimeModel) {
          model = unwrapJsonStringLiteral(runtimeModel);
        }
        continue;
      }

      if (entryType === 'assistant') {
        const message = readJsonRecord(data.message);
        const messageModel = readOptionalString(message?.model);
        if (messageModel) {
          model = unwrapJsonStringLiteral(messageModel);
        }
      }
    }

    return model;
  } catch {
    return null;
  }
};

const resolveQoderJsonlPath = (providerSessionId: string, projectPath?: string): string | null => {
  // Prefer the transcript path recorded by the synchronizer so cwd encoding
  // stays consistent with what the CLI actually wrote on disk.
  const storedPath = sessionsDb.getSessionByProviderSessionId(providerSessionId)?.jsonl_path
    ?? sessionsDb.getSessionById(providerSessionId)?.jsonl_path;
  if (storedPath) {
    return storedPath;
  }

  if (!projectPath) {
    return null;
  }

  // Fall back to the canonical layout when the row is not indexed yet:
  // ~/.qoder/projects/<cwd with '/' -> '-'>/<sessionId>.jsonl
  const encodedCwd = encodeQoderCwd(path.resolve(projectPath));
  return path.join(getQoderProjectsDir(), encodedCwd, `${providerSessionId}.jsonl`);
};

export class QoderProviderModels implements IProviderModels {
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    try {
      const stdout = await runQoderModelsCommand();
      const ids = parseQoderModelsStdout(stdout);
      if (ids.length === 0) {
        return QODER_FALLBACK_MODELS;
      }

      return {
        OPTIONS: ids.map((value) => ({
          value,
          label: value,
          description: `Qoder - ${value}`,
        })),
        DEFAULT: ids.includes(QODER_FALLBACK_MODELS.DEFAULT)
          ? QODER_FALLBACK_MODELS.DEFAULT
          : (ids[0] ?? QODER_FALLBACK_MODELS.DEFAULT),
      };
    } catch {
      return QODER_FALLBACK_MODELS;
    }
  }

  async getCurrentActiveModel(sessionId?: string): Promise<ProviderCurrentActiveModel> {
    if (!sessionId?.trim()) {
      return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
    }

    // Qoder transcripts are keyed by the provider-native session id; app-created
    // sessions must be translated through the mapping first.
    const sessionRow = sessionsDb.getSessionById(sessionId);
    const providerSessionId = sessionRow?.provider_session_id ?? sessionId;
    const jsonlPath = resolveQoderJsonlPath(providerSessionId, sessionRow?.project_path ?? undefined);

    if (jsonlPath) {
      const model = readQoderSessionModel(jsonlPath);
      if (model) {
        return {
          model,
        };
      }
    }

    return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
  }
}
