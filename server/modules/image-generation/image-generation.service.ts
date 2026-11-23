import { createHash, randomUUID } from 'node:crypto';
import { constants, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import type {
  GeneratedImageAsset, ImageGenerationInput, ImageGenerationJob,
  ImageGenerationJobPage, ImageGenerationProvider,
} from '@/shared/index.js';
import { ImageGenerationError } from '@/modules/image-generation/image-generation.error.js';

const MAX_IMAGE_BYTES = 64 * 1024 * 1024;
const JOB_ID = /^[a-f0-9]{64}$/;
const ASSET_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' } as const;
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');

type ServiceOptions = {
  projectDirectory: string;
  dataDirectory?: string;
  provider?: ImageGenerationProvider;
  maxImageBytes?: number;
};

type JobRecord = {
  version: 1;
  jobId: string;
  fingerprint: string;
  input: ImageGenerationInput;
  createdAt: string;
  updatedAt: string;
  status: Exclude<ImageGenerationJob['status'], 'missing_asset'>;
  ownerPid: number;
  assetId: string;
  asset?: GeneratedImageAsset;
  error?: { code: string; message: string };
};

function validateRequestId(value: string) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new ImageGenerationError('INVALID_INPUT', 'Use a nonempty ASCII requestId of at most 128 letters, digits, dots, colons, underscores or hyphens.');
  }
}

function validateInput(input: ImageGenerationInput) {
  validateRequestId(input.requestId);
  if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 32_000 || input.prompt.includes('\0')
    || (input.size !== undefined && !/^(auto|[0-9]{2,4}x[0-9]{2,4})$/.test(input.size))
    || (input.quality !== undefined && !/^[A-Za-z0-9_-]{1,32}$/.test(input.quality))) {
    throw new ImageGenerationError('INVALID_INPUT', 'Provide a prompt of 1–32000 characters and supported size/quality values.');
  }
}

// Only retry local transient filesystem operations, never provider generation.
async function retryFileOperation<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await operation(); } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
      if (attempt >= 3 || (!['EAGAIN', 'EBUSY', 'EACCES', 'EPERM'].includes(String(code)) && !(error instanceof SyntaxError))) throw error;
      await delay(20 * 2 ** attempt);
    }
  }
}

async function directory(directoryPath: string, create: boolean): Promise<string | null> {
  if (create) await fs.mkdir(directoryPath, { recursive: true, mode: 0o700 });
  let stat;
  try { stat = await fs.lstat(directoryPath); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !create) return null;
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Unsafe directory');
  return fs.realpath(directoryPath);
}

async function syncDirectory(directoryPath: string): Promise<void> {
  // POSIX requires syncing directory entries as well as file contents. Node
  // cannot open directory handles for fsync on Windows; file handles are synced.
  if (process.platform === 'win32') return;
  const handle = await fs.open(directoryPath, constants.O_RDONLY | constants.O_DIRECTORY);
  try { await handle.sync(); } finally { await handle.close(); }
}

async function readRegularFile(filePath: string, maxBytes: number): Promise<Buffer> {
  const before = await fs.lstat(filePath);
  if (before.isSymbolicLink() || !before.isFile() || before.size > maxBytes) throw new Error('Unsafe file');
  const handle = await fs.open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size > maxBytes) throw new Error('Unsafe opened file');
    if (opened.dev !== before.dev || opened.ino !== before.ino) {
      // Journal writers replace files atomically. Reopen after a handoff, but
      // never read bytes from a descriptor that differs from the checked file.
      throw Object.assign(new Error('File changed during open'), { code: 'EAGAIN' });
    }
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const buffer = Buffer.alloc(Math.min(64 * 1024, maxBytes - total + 1));
      const { bytesRead } = await handle.read(buffer);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > maxBytes) throw new Error('Oversized file');
      chunks.push(buffer.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks);
  } finally { await handle.close(); }
}

function imageType(bytes: Uint8Array): GeneratedImageAsset['mimeType'] {
  const image = Buffer.from(bytes);
  if (image.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png';
  if (image.length >= 3 && image[0] === 255 && image[1] === 216 && image[2] === 255) return 'image/jpeg';
  if (image.length >= 12 && image.toString('ascii', 0, 4) === 'RIFF' && image.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  throw new ImageGenerationError('INVALID_IMAGE', 'Only PNG, JPEG and WebP image results are supported.', 'uncertain');
}

/** Used by the optional MCP server and its integration tests; owns one fixed project's durable image jobs. */
export class ImageGenerationService {
  private readonly inFlight = new Map<string, {
    fingerprint: string;
    accepted: Promise<JobRecord>;
    promise: Promise<ImageGenerationJob>;
  }>();
  private readonly dataRoot: string;
  private readonly scope: string;
  private readonly maxImageBytes: number;

  private constructor(private readonly options: ServiceOptions, private readonly projectRoot: string) {
    this.dataRoot = path.resolve(options.dataDirectory ?? path.join(os.homedir(), '.cloudcli', 'image-generation'));
    this.scope = hash(projectRoot);
    this.maxImageBytes = options.maxImageBytes ?? 20 * 1024 * 1024;
  }

  static async create(options: ServiceOptions): Promise<ImageGenerationService> {
    if (!path.isAbsolute(options.projectDirectory)) throw new ImageGenerationError('INVALID_CONFIG', 'The image MCP project directory must be absolute.');
    if (options.dataDirectory !== undefined && !path.isAbsolute(options.dataDirectory)) throw new ImageGenerationError('INVALID_CONFIG', 'Use an absolute private image data directory so the MCP and web server share the same state.');
    try {
      const projectRoot = await fs.realpath(options.projectDirectory);
      if (!(await fs.stat(projectRoot)).isDirectory()) throw new Error('Not a directory');
      if (options.maxImageBytes !== undefined && (!Number.isInteger(options.maxImageBytes) || options.maxImageBytes < 1 || options.maxImageBytes > MAX_IMAGE_BYTES)) throw new Error('Invalid size');
      return new ImageGenerationService(options, projectRoot);
    } catch { throw new ImageGenerationError('INVALID_CONFIG', 'The image project or response-size configuration is invalid.'); }
  }

  get canGenerate(): boolean { return this.options.provider !== undefined; }

  private requestJobId(requestId: string): string {
    validateRequestId(requestId);
    return hash(this.scope + '\0' + requestId);
  }

  private async stateDirectory(create: boolean): Promise<string | null> {
    const root = await directory(this.dataRoot, create);
    return root ? directory(path.join(root, this.scope), create) : null;
  }

  private async outputDirectory(create: boolean): Promise<string | null> {
    if (path.relative(this.projectRoot, await fs.realpath(this.projectRoot)) !== '') throw new Error('Project changed');
    const output = await directory(path.join(this.projectRoot, 'generated-images'), create);
    if (output && path.relative(this.projectRoot, output) !== 'generated-images') throw new Error('Output escaped project');
    return output;
  }

  private parseRecord(bytes: Buffer, jobId: string): JobRecord {
    const value = JSON.parse(bytes.toString('utf8')) as JobRecord;
    if (!value || value.version !== 1 || value.jobId !== jobId || !JOB_ID.test(value.fingerprint)
      || !ASSET_ID.test(value.assetId) || !['running', 'succeeded', 'failed', 'uncertain'].includes(value.status)
      || !Number.isInteger(value.ownerPid) || value.ownerPid < 1
      || typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string'
      || !Number.isFinite(Date.parse(value.createdAt)) || !Number.isFinite(Date.parse(value.updatedAt))) throw new Error('Invalid job');
    validateInput(value.input);
    if (this.requestJobId(value.input.requestId) !== jobId) throw new Error('Wrong project');
    if (value.asset) {
      const asset = value.asset;
      if (asset.id !== value.assetId || !Object.hasOwn(EXTENSIONS, asset.mimeType)
        || asset.path !== 'generated-images/' + asset.id + '.' + EXTENSIONS[asset.mimeType]
        || !JOB_ID.test(asset.sha256) || !Number.isInteger(asset.bytes) || asset.bytes < 1 || asset.bytes > MAX_IMAGE_BYTES) throw new Error('Invalid asset');
    }
    if (value.status === 'succeeded' && !value.asset) throw new Error('Missing asset');
    if (value.error && (typeof value.error.code !== 'string' || !/^[A-Z0-9_]{1,64}$/.test(value.error.code)
      || typeof value.error.message !== 'string' || value.error.message.length > 1000)) throw new Error('Invalid diagnostic');
    return value;
  }

  private async readRecord(jobId: string): Promise<JobRecord | null> {
    if (typeof jobId !== 'string' || !JOB_ID.test(jobId)) throw new ImageGenerationError('INVALID_INPUT', 'Provide the saved 64-character jobId.');
    try {
      const state = await this.stateDirectory(false);
      if (!state) return null;
      return await retryFileOperation(async () => this.parseRecord(await readRegularFile(path.join(state, jobId + '.json'), 256 * 1024), jobId));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new ImageGenerationError('STATE_UNAVAILABLE', 'Saved image job metadata cannot be read. Generation will not be retried automatically.');
    }
  }

  private async updateRecord(state: string, record: JobRecord): Promise<void> {
    const temporary = path.join(state, '.' + record.jobId + '.' + randomUUID() + '.tmp');
    try {
      const handle = await fs.open(temporary, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify(record)); await handle.sync(); } finally { await handle.close(); }
      await retryFileOperation(() => fs.rename(temporary, path.join(state, record.jobId + '.json')));
      await syncDirectory(state);
    } finally { await fs.unlink(temporary).catch(() => undefined); }
  }

  private async view(record: JobRecord): Promise<ImageGenerationJob> {
    const common = {
      kind: 'cloudcli.image_generation' as const, version: 1 as const,
      jobId: record.jobId, createdAt: record.createdAt, updatedAt: record.updatedAt,
      promptPreview: Array.from(record.input.prompt).slice(0, 200).join(''),
    };
    if (record.asset) {
      try {
        const output = await this.outputDirectory(false);
        if (!output) throw new Error('Missing output');
        const bytes = await readRegularFile(path.join(output, path.basename(record.asset.path)), record.asset.bytes);
        if (bytes.length !== record.asset.bytes || hash(bytes) !== record.asset.sha256 || imageType(bytes) !== record.asset.mimeType) throw new Error('Changed image');
        return { ...common, status: 'succeeded', asset: record.asset };
      } catch {
        if (record.status === 'succeeded') return { ...common, status: 'missing_asset', error: { code: 'ASSET_UNAVAILABLE', message: 'The saved image is missing, changed or inaccessible. It is not regenerated automatically.' } };
      }
    }
    let ownerRunning = this.inFlight.has(record.jobId);
    if (!ownerRunning && Date.now() - Date.parse(record.createdAt) <= 330_000) {
      try { process.kill(record.ownerPid, 0); ownerRunning = true; } catch (error) {
        ownerRunning = (error as NodeJS.ErrnoException).code === 'EPERM';
      }
    }
    const status = record.status === 'running' && !ownerRunning ? 'uncertain' : record.status;
    return {
      ...common, status,
      ...(status === 'uncertain' ? { error: { code: 'GENERATION_UNCERTAIN', message: 'The provider may still be processing, or the process stopped before saving the result. Inspect this job; do not automatically submit a new requestId.' } }
        : record.error ? { error: record.error } : {}),
    };
  }

  async getJob(jobId: string, waitMs = 0): Promise<ImageGenerationJob> {
    if (!Number.isInteger(waitMs) || waitMs < 0 || waitMs > 20_000) throw new ImageGenerationError('INVALID_INPUT', 'waitMs must be between 0 and 20000.');
    let record = await this.readRecord(jobId);
    if (!record) throw new ImageGenerationError('JOB_NOT_FOUND', 'No saved image job exists in this project for that identifier.');
    if (waitMs > 0 && record.status === 'running') {
      const active = this.inFlight.get(jobId);
      const timer = new AbortController();
      try {
        const timeout = delay(waitMs, undefined, { signal: timer.signal }).catch(() => undefined);
        if (active) await Promise.race([active.promise.catch(() => undefined), timeout]);
        else {
          const deadline = Date.now() + waitMs;
          while (record.status === 'running' && Date.now() < deadline) {
            const current = await this.view(record);
            if (current.status !== 'running') return current;
            await delay(Math.min(250, Math.max(0, deadline - Date.now())));
            record = await this.readRecord(jobId) ?? record;
          }
        }
      } finally { timer.abort(); }
      record = await this.readRecord(jobId) ?? record;
    }
    return this.view(record);
  }

  async getJobForRequest(requestId: string, waitMs = 0): Promise<ImageGenerationJob> {
    return this.getJob(this.requestJobId(requestId), waitMs);
  }

  async listJobs(limit = 10, cursor?: string): Promise<ImageGenerationJobPage> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 20 || (cursor !== undefined && !JOB_ID.test(cursor))) throw new ImageGenerationError('INVALID_INPUT', 'Use a limit from 1 to 20 and a valid optional job cursor.');
    try {
      const state = await this.stateDirectory(false);
      if (!state) return { jobs: [], unreadableJobs: 0 };
      const names = (await fs.readdir(state, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && /^[a-f0-9]{64}\.json$/.test(entry.name))
        .map((entry) => entry.name.slice(0, -5)).sort().filter((id) => !cursor || id > cursor);
      const selected = names.slice(0, limit);
      const jobs: ImageGenerationJob[] = [];
      let unreadableJobs = 0;
      for (const id of selected) {
        try { jobs.push(await this.getJob(id)); } catch { unreadableJobs++; }
      }
      return { jobs, unreadableJobs, ...(names.length > limit ? { nextCursor: selected[selected.length - 1] } : {}) };
    } catch (error) {
      if (error instanceof ImageGenerationError) throw error;
      throw new ImageGenerationError('STATE_UNAVAILABLE', 'The saved image job directory cannot be read.');
    }
  }

  async submit(request: ImageGenerationInput): Promise<ImageGenerationJob> {
    validateInput(request);
    // Snapshot only supported fields before the first await; caller mutation
    // must not change the prompt after its idempotency fingerprint is saved.
    const input: ImageGenerationInput = Object.freeze({
      requestId: request.requestId, prompt: request.prompt,
      ...(request.size === undefined ? {} : { size: request.size }),
      ...(request.quality === undefined ? {} : { quality: request.quality }),
    });
    const provider = this.options.provider;
    if (!provider) throw new ImageGenerationError('NOT_CONFIGURED', 'Configure an image provider before generating an image. Saved-image lookup remains available.');
    const jobId = this.requestJobId(input.requestId);
    const fingerprint = hash(JSON.stringify({ prompt: input.prompt, size: input.size ?? null, quality: input.quality ?? null, provider: provider.identity }));
    const existing = await this.readRecord(jobId);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new ImageGenerationError('REQUEST_ID_CONFLICT', 'That requestId belongs to different generation parameters. Recover the existing job or intentionally use a new requestId.');
      return this.view(existing);
    }
    const active = this.inFlight.get(jobId);
    if (active) {
      if (active.fingerprint !== fingerprint) throw new ImageGenerationError('REQUEST_ID_CONFLICT', 'That requestId is already in use for different parameters.');
      return this.view(await active.accepted);
    }
    if (this.inFlight.size >= 1) throw new ImageGenerationError('GENERATOR_BUSY', 'An image request is already in progress. This new request was not accepted; retry the same requestId after it finishes.');
    let accept!: (record: JobRecord) => void;
    let reject!: (error: unknown) => void;
    const accepted = new Promise<JobRecord>((resolve, fail) => { accept = resolve; reject = fail; });
    const promise = this.performGeneration(input, jobId, fingerprint, provider, accept)
      .catch((error: unknown) => { reject(error); throw error; })
      .finally(() => { this.inFlight.delete(jobId); });
    this.inFlight.set(jobId, { fingerprint, accepted, promise });
    // Accepted work continues independently of a chat turn/transport timeout.
    // Failures remain in the journal and are read without a second paid call.
    void promise.catch(() => undefined);
    return this.view(await accepted);
  }

  private async performGeneration(input: ImageGenerationInput, jobId: string, fingerprint: string, provider: ImageGenerationProvider, accept: (record: JobRecord) => void): Promise<ImageGenerationJob> {
    let state: string;
    let output: string;
    try {
      state = (await this.stateDirectory(true))!;
      output = (await this.outputDirectory(true))!;
    } catch { throw new ImageGenerationError('STORAGE_UNAVAILABLE', 'Image job or project output storage is unavailable. The provider was not called.'); }

    const now = new Date().toISOString();
    const record: JobRecord = { version: 1, jobId, fingerprint, input, assetId: randomUUID(), ownerPid: process.pid, createdAt: now, updatedAt: now, status: 'running' };
    // Exclusive creation is the cross-process admission barrier. An existing
    // record (including uncertain/failed states) never starts another request.
    let handle;
    try { handle = await fs.open(path.join(state, jobId + '.json'), 'wx', 0o600); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        const accepted = await this.readRecord(jobId);
        if (!accepted || accepted.fingerprint !== fingerprint) throw new ImageGenerationError('REQUEST_ID_CONFLICT', 'The requestId has already been accepted with different parameters.');
        accept(accepted);
        return this.view(accepted);
      }
      throw new ImageGenerationError('STATE_UNAVAILABLE', 'The image request could not be saved. The provider was not called.');
    }
    try { await handle.writeFile(JSON.stringify(record)); await handle.sync(); } catch {
      throw new ImageGenerationError('STATE_UNAVAILABLE', 'Image request metadata could not be saved. The provider was not called.');
    } finally { await handle.close(); }
    try { await syncDirectory(state); } catch {
      throw new ImageGenerationError('STATE_UNAVAILABLE', 'The image admission record could not be durably saved. The provider was not called.');
    }
    accept(record);

    try {
      const bytes = await provider.generate(input, AbortSignal.timeout(300_000));
      if (bytes.byteLength === 0 || bytes.byteLength > this.maxImageBytes) throw new Error('Image size');
      const mimeType = imageType(bytes);
      const asset: GeneratedImageAsset = {
        id: record.assetId, path: 'generated-images/' + record.assetId + '.' + EXTENSIONS[mimeType],
        mimeType, bytes: bytes.byteLength, sha256: hash(bytes),
      };
      // Persist the expected digest before writing the project file. A crash
      // after the write can be recovered by read-only tools without API calls.
      record.asset = asset;
      await this.updateRecord(state, record);
      await this.outputDirectory(false);
      const image = await fs.open(path.join(output, path.basename(asset.path)), 'wx', 0o600);
      try { await image.writeFile(bytes); await image.sync(); } finally { await image.close(); }
      record.status = 'succeeded';
      record.updatedAt = new Date().toISOString();
      await this.updateRecord(state, record);
    } catch (error) {
      const rejected = error instanceof ImageGenerationError && error.outcome === 'rejected';
      record.status = rejected ? 'failed' : 'uncertain';
      record.updatedAt = new Date().toISOString();
      record.error = {
        code: error instanceof ImageGenerationError && /^PROVIDER_(HTTP_[0-9]{3}|UNCERTAIN|INVALID_RESPONSE)$/.test(error.code) ? error.code : 'GENERATION_UNCERTAIN',
        message: rejected ? 'The image provider rejected the request. Check configuration before intentionally requesting another generation.' : 'The generation outcome is uncertain. This requestId will not trigger another provider request.',
      };
      await this.updateRecord(state, record).catch(() => undefined);
    }
    return this.view(record);
  }
}

/** Used by the web composition root/tests to resolve registered project IDs without configuring a provider. */
export function createProjectImageJobReader(
  options: {
    getProjectPath: (projectId: string) => string | null | Promise<string | null>;
    resolveReadablePath: (projectPath: string) => Promise<string | null>;
    dataDirectory?: string;
  },
) {
  return async (projectId: string, jobId: string): Promise<ImageGenerationJob> => {
    const registered = await options.getProjectPath(projectId);
    const projectDirectory = registered ? await options.resolveReadablePath(registered) : null;
    if (!projectDirectory) throw new ImageGenerationError('PROJECT_NOT_FOUND', 'Project not found.');
    const service = await ImageGenerationService.create({ projectDirectory, dataDirectory: options.dataDirectory });
    return service.getJob(jobId);
  };
}
