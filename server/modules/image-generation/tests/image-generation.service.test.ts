import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fileSystem } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { ImageGenerationInput, ImageGenerationProvider } from '@/shared/index.js';
import { ImageGenerationError } from '@/modules/image-generation/image-generation.error.js';
import { ImageGenerationService } from '@/modules/image-generation/image-generation.service.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgSPkPAAHLAWRRDtICAAAAAElFTkSuQmCC', 'base64');
const INPUT = { requestId: 'image-1', prompt: '  蓝色の海 — غروب 🌅\nKeep this exact prompt.  ', size: '1024x1024' };

class TestProvider implements ImageGenerationProvider {
  readonly identity = 'synthetic-provider';
  readonly requests: ImageGenerationInput[] = [];
  operation: () => Promise<Uint8Array> = async () => PNG;
  async generate(input: ImageGenerationInput) { this.requests.push(input); return this.operation(); }
}

async function fixture(run: (context: {
  root: string; project: string; data: string; provider: TestProvider; service: ImageGenerationService;
}) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cloudcli-image-service-'));
  const project = path.join(root, 'project');
  const data = path.join(root, 'private-state');
  await mkdir(project);
  const provider = new TestProvider();
  const service = await ImageGenerationService.create({ projectDirectory: project, dataDirectory: data, provider });
  try { await run({ root, project, data, provider, service }); } finally {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('cloudcli-image-service-'));
    await rm(root, { recursive: true, force: true });
  }
}

async function recordPath(data: string): Promise<string> {
  const [scope] = await readdir(data);
  const name = (await readdir(path.join(data, scope))).find((entry) => entry.endsWith('.json'));
  assert.ok(name);
  return path.join(data, scope, name);
}

test('submission journals the exact prompt before the provider runs and saves a digest-bound project image', async () => {
  await fixture(async ({ project, data, provider, service }) => {
    await writeFile(path.join(project, 'customization.txt'), 'preserve this');
    provider.operation = async () => {
      const saved = JSON.parse(await readFile(await recordPath(data), 'utf8'));
      assert.equal(saved.status, 'running');
      assert.equal(saved.input.prompt, INPUT.prompt);
      return PNG;
    };
    const accepted = await service.submit(INPUT);
    assert.match(accepted.jobId, /^[a-f0-9]{64}$/);
    const job = await service.getJob(accepted.jobId, 20_000);
    assert.equal(job.kind, 'cloudcli.image_generation');
    assert.equal(job.status, 'succeeded');
    assert.ok(job.asset);
    assert.match(job.asset.path, /^generated-images\/[a-f0-9-]+\.png$/);
    assert.equal(job.asset.bytes, PNG.length);
    assert.equal(job.asset.sha256, createHash('sha256').update(PNG).digest('hex'));
    assert.deepEqual(await readFile(path.join(project, job.asset.path)), PNG);
    assert.equal(await readFile(path.join(project, 'customization.txt'), 'utf8'), 'preserve this');
    assert.deepEqual(provider.requests, [INPUT]);
  });
});

test('restart/credential-free lookup and replay reuse one image without another provider call', async () => {
  await fixture(async ({ project, data, provider, service }) => {
    const accepted = await service.submit(INPUT);
    const original = await service.getJob(accepted.jobId, 20_000);
    const reopened = await ImageGenerationService.create({ projectDirectory: project, dataDirectory: data });
    assert.equal(reopened.canGenerate, false);
    assert.deepEqual(await reopened.getJobForRequest(INPUT.requestId), original);
    assert.deepEqual((await reopened.listJobs()).jobs, [original]);
    const configured = await ImageGenerationService.create({ projectDirectory: project, dataDirectory: data, provider });
    assert.deepEqual(await configured.submit(INPUT), original);
    assert.equal(provider.requests.length, 1);
  });
});

test('same request ID with changed parameters is rejected without regenerating', async () => {
  await fixture(async ({ provider, service }) => {
    const accepted = await service.submit(INPUT);
    await service.getJob(accepted.jobId, 20_000);
    await assert.rejects(service.submit({ ...INPUT, prompt: 'different' }), { code: 'REQUEST_ID_CONFLICT' });
    assert.equal(provider.requests.length, 1);
  });
});

test('exclusive admission deduplicates simultaneous requests across separate service instances', async () => {
  await fixture(async ({ project, data, provider, service }) => {
    let finish!: (value: Uint8Array) => void;
    provider.operation = () => new Promise((resolve) => { finish = resolve; });
    const other = await ImageGenerationService.create({ projectDirectory: project, dataDirectory: data, provider });
    const [first, second] = await Promise.all([service.submit(INPUT), other.submit(INPUT)]);
    try {
      assert.equal(first.jobId, second.jobId);
      assert.equal(provider.requests.length, 1);
    } finally { finish(PNG); }
    assert.equal((await service.getJob(first.jobId, 20_000)).status, 'succeeded');
  });
});

test('new work is bounded while an accepted job runs; duplicate calls remain safe', async () => {
  await fixture(async ({ provider, service }) => {
    let finish!: (value: Uint8Array) => void;
    provider.operation = () => new Promise((resolve) => { finish = resolve; });
    const accepted = await service.submit(INPUT);
    try {
      assert.equal((await service.submit(INPUT)).jobId, accepted.jobId);
      await assert.rejects(service.submit({ ...INPUT, requestId: 'new-image' }), { code: 'GENERATOR_BUSY' });
      assert.equal(provider.requests.length, 1);
    } finally { finish(PNG); }
    await service.getJob(accepted.jobId, 20_000);
  });
});

for (const outcome of ['rejected', 'uncertain'] as const) {
  test('provider ' + outcome + ' state is saved, redacted and never automatically retried', async () => {
    await fixture(async ({ data, provider, service }) => {
      provider.operation = async () => { throw new ImageGenerationError('PROVIDER_HTTP_503', 'private-key-and-provider-details', outcome); };
      const accepted = await service.submit(INPUT);
      const saved = await service.getJob(accepted.jobId, 20_000);
      assert.equal(saved.status, outcome === 'rejected' ? 'failed' : 'uncertain');
      assert.equal((await service.submit(INPUT)).status, saved.status);
      assert.equal(provider.requests.length, 1);
      assert.doesNotMatch(JSON.stringify(saved), /private-key-and-provider-details/);
      assert.doesNotMatch(await readFile(await recordPath(data), 'utf8'), /private-key-and-provider-details/);
    });
  });
}

test('a stopped process journal returns uncertainty without a second generation', async () => {
  await fixture(async ({ data, project, provider, service }) => {
    const accepted = await service.submit(INPUT);
    await service.getJob(accepted.jobId, 20_000);
    const file = await recordPath(data);
    const record = JSON.parse(await readFile(file, 'utf8'));
    record.status = 'running';
    record.ownerPid = 2147483647;
    record.createdAt = new Date(0).toISOString();
    delete record.asset;
    await writeFile(file, JSON.stringify(record));
    const reopened = await ImageGenerationService.create({ projectDirectory: project, dataDirectory: data, provider });
    assert.equal((await reopened.getJob(accepted.jobId)).status, 'uncertain');
    assert.equal((await reopened.submit(INPUT)).status, 'uncertain');
    assert.equal(provider.requests.length, 1);
  });
});

test('an image saved before the final journal update is recovered by digest without a paid request', async () => {
  await fixture(async ({ data, project, provider, service }) => {
    const accepted = await service.submit(INPUT);
    const complete = await service.getJob(accepted.jobId, 20_000);
    const file = await recordPath(data);
    const record = JSON.parse(await readFile(file, 'utf8'));
    record.status = 'running';
    record.ownerPid = 2147483647;
    await writeFile(file, JSON.stringify(record));
    const reopened = await ImageGenerationService.create({ projectDirectory: project, dataDirectory: data });
    assert.equal((await reopened.getJob(accepted.jobId)).status, 'succeeded');
    assert.deepEqual((await reopened.getJob(accepted.jobId)).asset, complete.asset);
    assert.equal(provider.requests.length, 1);
  });
});

test('missing or changed assets do not cause regeneration', async () => {
  await fixture(async ({ project, provider, service }) => {
    const accepted = await service.submit(INPUT);
    const job = await service.getJob(accepted.jobId, 20_000);
    await writeFile(path.join(project, job.asset!.path), 'modified');
    assert.equal((await service.getJob(job.jobId)).status, 'missing_asset');
    await unlink(path.join(project, job.asset!.path));
    assert.equal((await service.submit(INPUT)).status, 'missing_asset');
    assert.equal(provider.requests.length, 1);
  });
});

test('project namespaces and identifier validation prevent cross-project lookup', async () => {
  await fixture(async ({ root, data, provider, service }) => {
    const accepted = await service.submit(INPUT);
    await service.getJob(accepted.jobId, 20_000);
    const secondProject = path.join(root, 'second-project');
    await mkdir(secondProject);
    const other = await ImageGenerationService.create({ projectDirectory: secondProject, dataDirectory: data });
    await assert.rejects(other.getJob(accepted.jobId), { code: 'JOB_NOT_FOUND' });
    await assert.rejects(service.getJob('../outside'), { code: 'INVALID_INPUT' });
    await assert.rejects(service.submit({ ...INPUT, requestId: '../outside' }), { code: 'INVALID_INPUT' });
    assert.equal(provider.requests.length, 1);
  });
});

test('read-only empty lookups do not create state or project output directories', async () => {
  await fixture(async ({ data, project, service }) => {
    assert.deepEqual(await service.listJobs(), { jobs: [], unreadableJobs: 0 });
    await assert.rejects(service.getJob('a'.repeat(64)), { code: 'JOB_NOT_FOUND' });
    await assert.rejects(access(data), { code: 'ENOENT' });
    await assert.rejects(access(path.join(project, 'generated-images')), { code: 'ENOENT' });
  });
});

test('symlinked output directories are rejected before calling the provider', async () => {
  await fixture(async ({ root, project, provider, service }) => {
    const outside = path.join(root, 'outside');
    await mkdir(outside);
    await symlink(outside, path.join(project, 'generated-images'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(service.submit(INPUT), { code: 'STORAGE_UNAVAILABLE' });
    assert.equal(provider.requests.length, 0);
    assert.deepEqual(await readdir(outside), []);
  });
});

test('a saved image cannot be reopened through a replaced output-directory symlink', async () => {
  await fixture(async ({ root, project, service }) => {
    const accepted = await service.submit(INPUT);
    const saved = await service.getJob(accepted.jobId, 20_000);
    const moved = path.join(root, 'moved-output');
    await rename(path.join(project, 'generated-images'), moved);
    await symlink(moved, path.join(project, 'generated-images'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal((await service.getJob(saved.jobId)).status, 'missing_asset');
  });
});

test('pagination is bounded and corrupt metadata does not hide other jobs', async () => {
  await fixture(async ({ data, service }) => {
    for (let index = 0; index < 3; index++) {
      const job = await service.submit({ ...INPUT, requestId: 'page-' + index });
      await service.getJob(job.jobId, 20_000);
    }
    const first = await service.listJobs(2);
    assert.equal(first.jobs.length, 2);
    assert.ok(first.nextCursor);
    const second = await service.listJobs(2, first.nextCursor);
    assert.equal(second.jobs.length, 1);
    assert.equal(new Set([...first.jobs, ...second.jobs].map((job) => job.jobId)).size, 3);
    await writeFile(await recordPath(data), '{');
    const partial = await service.listJobs(20);
    assert.equal(partial.unreadableJobs, 1);
    assert.equal(partial.jobs.length, 2);
  });
});

test('submission snapshots supported parameters and never journals unrelated caller fields', async () => {
  await fixture(async ({ data, provider, service }) => {
    const request = { ...INPUT, extraSecret: 'never-persist-this-extra-field' };
    const accepted = service.submit(request);
    request.prompt = 'changed after submission';
    const job = await accepted;
    await service.getJob(job.jobId, 20_000);
    assert.equal(provider.requests[0].prompt, INPUT.prompt);
    const journal = await readFile(await recordPath(data), 'utf8');
    assert.doesNotMatch(journal, /never-persist-this-extra-field|changed after submission/);
  });
});

test('invalid image bytes preserve an uncertain job without writing or regenerating an asset', async () => {
  await fixture(async ({ project, provider, service }) => {
    provider.operation = async () => Buffer.from('<svg></svg>');
    const accepted = await service.submit(INPUT);
    assert.equal((await service.getJob(accepted.jobId, 20_000)).status, 'uncertain');
    assert.deepEqual(await readdir(path.join(project, 'generated-images')), []);
    assert.equal((await service.submit(INPUT)).status, 'uncertain');
    assert.equal(provider.requests.length, 1);
  });
});

test('private state-directory symlinks are refused before contacting the provider', async () => {
  await fixture(async ({ root, data, provider, service }) => {
    const outside = path.join(root, 'outside-state');
    await mkdir(outside);
    await symlink(outside, data, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(service.submit(INPUT), { code: 'STATE_UNAVAILABLE' });
    assert.equal(provider.requests.length, 0);
    assert.deepEqual(await readdir(outside), []);
  });
});

test('private data location must be absolute and invalid input never calls the provider', async () => {
  await fixture(async ({ project, provider, service }) => {
    await assert.rejects(ImageGenerationService.create({ projectDirectory: project, dataDirectory: 'relative-state' }), { code: 'INVALID_CONFIG' });
    await assert.rejects(service.submit({ ...INPUT, prompt: ' ' }), { code: 'INVALID_INPUT' });
    await assert.rejects(service.submit({ ...INPUT, quality: 'unexpected value' }), { code: 'INVALID_INPUT' });
    assert.equal(provider.requests.length, 0);
  });
});

test('job reads safely retry an atomic journal replacement between lstat and open', async (context) => {
  await fixture(async ({ data, service }) => {
    const accepted = await service.submit(INPUT);
    const saved = await service.getJob(accepted.jobId, 20_000);
    const file = await recordPath(data);
    const contents = await readFile(file);
    const originalOpen = fileSystem.open.bind(fileSystem);
    let replaced = false;
    let journalReads = 0;
    context.mock.method(fileSystem, 'open', async (...args: Parameters<typeof fileSystem.open>) => {
      if (args[0] === file && typeof args[1] === 'number') {
        journalReads++;
        if (!replaced) {
          replaced = true;
          const next = file + '.next';
          await writeFile(next, contents);
          await rename(next, file);
        }
      }
      return originalOpen(...args);
    });
    assert.deepEqual(await service.getJob(saved.jobId), saved);
    assert.equal(replaced, true);
    assert.ok(journalReads >= 2);
  });
});
