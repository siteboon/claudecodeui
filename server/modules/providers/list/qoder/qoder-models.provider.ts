import crossSpawn from 'cross-spawn';

import { sessionsDb } from '@/modules/database/index.js';
import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderCurrentActiveModel,
  ProviderModelsDefinition,
} from '@/shared/types.js';
import {
  buildDefaultProviderCurrentActiveModel,
  readJsonRecord,
  readJsonlEntries,
  readOptionalString,
  resolveQoderTranscriptPath,
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

/**
 * A row of `qodercli --list-models` output that names a usable model.
 *
 * Verified against v1.1.13, rows come in exactly two shapes: a bare id, or an
 * id followed by a parenthesized alias (`Peach-07-17-DogFooding
 * (qwen3.8-max-preview)`). Matching the whole line — rather than just its first
 * token — is what lets free-form output such as `Available models:` be rejected.
 */
const QODER_MODEL_ROW_PATTERN = /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\s+\([^)]*\))?$/;

// Consumed by getSupportedModels below and by tests/qoder-models.test.ts, which
// pins the parser against captured `qodercli --list-models` output.
export const parseQoderModelsStdout = (stdout: string): string[] => {
  const ids: string[] = [];

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    // `qodercli --list-models` prints a literal `MODEL` header row before the
    // model ids. It must not surface as a selectable model — picking it would
    // pass `-m MODEL` and qodercli rejects it with exit 42 ("Invalid model").
    if (!line || line === 'MODEL') {
      continue;
    }

    // Only the id is usable: `-m "Peach-07-17-DogFooding (qwen3.8-max-preview)"`
    // fails with `Invalid model "..."`.
    const id = line.match(QODER_MODEL_ROW_PATTERN)?.[1];
    if (!id) {
      // Banners, warnings and JSON diagnostics land here. Offering them as
      // models would give the user a selection that can only fail.
      console.warn(`[Qoder] Ignoring unrecognized --list-models row: ${line}`);
      continue;
    }

    ids.push(id);
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
type SessionModelCacheEntry = { model: string | null; expiresAt: number };
const sessionModelCache = new Map<string, SessionModelCacheEntry>();
const SESSION_MODEL_CACHE_TTL_MS = 30_000;

const cleanupExpiredSessionModelCache = (): void => {
  const now = Date.now();
  for (const [key, entry] of sessionModelCache) {
    if (entry.expiresAt <= now) {
      sessionModelCache.delete(key);
    }
  }
};

const readQoderSessionModel = async (jsonlPath: string): Promise<string | null> => {
  cleanupExpiredSessionModelCache();
  const cached = sessionModelCache.get(jsonlPath);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.model;
  }

  let model: string | null = null;

  // Streamed rather than read whole: transcripts grow without bound, and this
  // runs on every active-model query.
  for await (const data of readJsonlEntries(jsonlPath)) {
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

  sessionModelCache.set(jsonlPath, {
    model,
    expiresAt: Date.now() + SESSION_MODEL_CACHE_TTL_MS,
  });
  return model;
};

/**
 * Normalize a model name read from a Qoder transcript against the supported
 * model catalog.
 *
 * Transcripts may record names with different casing (`auto`) or with a
 * parenthesized alias (`Peach-07-17-DogFooding (qwen3.8-max-preview)`). This
 * returns the canonical catalog value when a match is found, or `null` when
 * the name cannot be reconciled so the caller can fall back to the default.
 */
const normalizeQoderModelName = (
  rawModel: string,
  supportedModels: ProviderModelsDefinition,
): string | null => {
  const options = supportedModels.OPTIONS;
  if (options.length === 0) {
    return rawModel;
  }

  const candidate = rawModel.replace(/\s+\([^)]*\)\s*$/, '').trim();
  if (!candidate) {
    return null;
  }

  // Exact match.
  const exact = options.find((option) => option.value === candidate);
  if (exact) {
    return exact.value;
  }

  // Case-insensitive value match.
  const lowerCandidate = candidate.toLowerCase();
  const byValue = options.find((option) => option.value.toLowerCase() === lowerCandidate);
  if (byValue) {
    return byValue.value;
  }

  // Case-insensitive label match.
  const byLabel = options.find((option) => option.label.toLowerCase() === lowerCandidate);
  if (byLabel) {
    return byLabel.value;
  }

  return null;
};

const resolveQoderJsonlPath = (providerSessionId: string, projectPath?: string): string | null => {
  // Prefer the transcript path recorded by the synchronizer so cwd encoding
  // stays consistent with what the CLI actually wrote on disk.
  const storedPath = sessionsDb.getSessionByProviderSessionId(providerSessionId)?.jsonl_path
    ?? sessionsDb.getSessionById(providerSessionId)?.jsonl_path;
  if (storedPath) {
    return storedPath;
  }

  // Fall back to the canonical layout when the row is not indexed yet. The
  // shared resolver owns the cwd encoding and rejects session ids that could
  // traverse out of the projects directory.
  return resolveQoderTranscriptPath({ cwd: projectPath, sessionId: providerSessionId });
};

const QODER_MODELS_MEMO_TTL_MS = 5 * 60 * 1000;

/**
 * Process-local memo for the catalog.
 *
 * `getSupportedModels` spawns `qodercli --list-models`, and
 * `getCurrentActiveModel` falls back to it whenever a session has no recorded
 * model — that path bypasses providerModelsService's on-disk cache, so without
 * this memo a burst of active-model queries becomes a burst of CLI spawns, each
 * with a 20s timeout. Failures are not memoized so the next call retries.
 */
let cachedModels: { models: ProviderModelsDefinition; expiresAt: number } | null = null;

export class QoderProviderModels implements IProviderModels {
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    if (cachedModels && cachedModels.expiresAt > Date.now()) {
      return cachedModels.models;
    }

    try {
      const stdout = await runQoderModelsCommand();
      const ids = parseQoderModelsStdout(stdout);
      if (ids.length === 0) {
        return QODER_FALLBACK_MODELS;
      }

      const models: ProviderModelsDefinition = {
        OPTIONS: ids.map((value) => ({
          value,
          label: value,
          description: `Qoder - ${value}`,
        })),
        DEFAULT: ids.includes(QODER_FALLBACK_MODELS.DEFAULT)
          ? QODER_FALLBACK_MODELS.DEFAULT
          : (ids[0] ?? QODER_FALLBACK_MODELS.DEFAULT),
      };
      cachedModels = { models, expiresAt: Date.now() + QODER_MODELS_MEMO_TTL_MS };
      return models;
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
      const rawModel = await readQoderSessionModel(jsonlPath);
      if (rawModel) {
        const supportedModels = await this.getSupportedModels();
        const model = normalizeQoderModelName(rawModel, supportedModels);
        if (model) {
          return { model };
        }
      }
    }

    return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
  }
}
