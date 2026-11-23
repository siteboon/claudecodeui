import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import test from 'node:test';

import type { ImageGenerationJob, ImageGenerationJobPage } from '@/shared/index.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgSPkPAAHLAWRRDtICAAAAAElFTkSuQmCC', 'base64');
const KEY = 'synthetic-mcp-provider-key';
const INPUT = { requestId: 'native-tool-request-1', prompt: 'A synthetic blue image, 日本語 — exact prompt.' };

async function startMcp(project: string, data: string, endpoint: string, configured = true) {
  const environment: Record<string, string> = {};
  for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP']) {
    if (process.env[key]) environment[key] = process.env[key]!;
  }
  Object.assign(environment, {
    HOME: path.dirname(project), USERPROFILE: path.dirname(project),
    TSX_TSCONFIG_PATH: path.resolve('server/tsconfig.json'),
    CLOUDCLI_IMAGE_DATA_DIR: data, CLOUDCLI_IMAGE_ENDPOINT: endpoint,
    ...(configured ? { CLOUDCLI_IMAGE_API_KEY: KEY, CLOUDCLI_IMAGE_MODEL: 'synthetic-model' } : {}),
  });
  const child = spawn(process.execPath, [
    '--import', 'tsx', 'server/modules/image-generation/image-generation.cli.ts', '--project', project,
  ], { cwd: process.cwd(), env: environment, stdio: 'pipe', windowsHide: true });
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  let nextId = 0;
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-64 * 1024); });
  const lines = createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    let message: { id?: number; result?: unknown; error?: unknown };
    try { message = JSON.parse(line); } catch {
      for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('Non-protocol stdout')); }
      pending.clear();
      return;
    }
    const item = message.id === undefined ? undefined : pending.get(message.id);
    if (!item) return;
    pending.delete(message.id!);
    clearTimeout(item.timer);
    if (message.error) item.reject(new Error(JSON.stringify(message.error)));
    else item.resolve(message.result);
  });
  child.on('error', (error) => {
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); }
    pending.clear();
  });
  child.on('exit', () => {
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('MCP process exited: ' + stderr)); }
    pending.clear();
  });
  const rpc = (method: string, params: unknown = {}): Promise<unknown> => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('MCP response timed out: ' + method)); }, 10_000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  const stop = async (crash = false) => {
    if (child.exitCode !== null || child.signalCode !== null || !child.pid) { lines.close(); return; }
    const exited = once(child, 'exit');
    if (crash) child.kill();
    else child.stdin.end();
    const timer = setTimeout(() => { child.kill(); }, 1000);
    try { await exited; } finally { clearTimeout(timer); lines.close(); }
  };
  try {
    await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'image-integration-test', version: '1.0.0' } });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  } catch (error) { await stop(true); throw error; }
  return {
    rpc, stop, stderr: () => stderr,
    async tool<T>(name: string, args: unknown) {
      return await rpc('tools/call', { name, arguments: args }) as {
        structuredContent?: T; content: Array<{ type: string; text?: string }>; isError?: boolean;
      };
    },
  };
}

async function fixture(run: (context: {
  project: string; data: string; endpoint: string; calls: () => number;
  started: Promise<void>; complete: () => void;
}) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cloudcli-image-mcp-'));
  const project = path.join(root, 'project');
  const data = path.join(root, 'private-state');
  await mkdir(project);
  let calls = 0;
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const responses: http.ServerResponse[] = [];
  const server = http.createServer(async (request, response) => {
    calls++;
    assert.equal(request.headers.authorization, 'Bearer ' + KEY);
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(body.prompt, INPUT.prompt);
    assert.equal(body.n, 1);
    responses.push(response);
    markStarted();
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await run({ project, data, endpoint: 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/images/generations',
      calls: () => calls, started,
      complete: () => responses.forEach((response) => response.end(JSON.stringify({ data: [{ b64_json: PNG.toString('base64') }] }))),
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('cloudcli-image-mcp-'));
    await rm(root, { recursive: true, force: true });
  }
}

test('real stdio MCP tools generate once, render a durable path, and reopen without a provider key', { timeout: 30_000 }, async () => {
  await fixture(async ({ project, data, endpoint, calls, started, complete }) => {
    const client = await startMcp(project, data, endpoint);
    let jobId: string;
    try {
      const tools = await client.rpc('tools/list') as { tools: Array<{ name: string; annotations: Record<string, boolean> }> };
      assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), ['generate_image', 'get_image_job', 'list_generated_images']);
      const generate = tools.tools.find((tool) => tool.name === 'generate_image')!;
      assert.equal(generate.annotations.readOnlyHint, false);
      assert.equal(generate.annotations.openWorldHint, true);
      assert.equal(tools.tools.find((tool) => tool.name === 'get_image_job')!.annotations.readOnlyHint, true);
      const accepted = await client.tool<ImageGenerationJob>('generate_image', INPUT);
      assert.equal(accepted.structuredContent!.status, 'running');
      jobId = accepted.structuredContent!.jobId;
      await started;
      const duplicate = await client.tool<ImageGenerationJob>('generate_image', INPUT);
      assert.equal(duplicate.structuredContent!.jobId, jobId);
      assert.equal(calls(), 1);
      const pending = client.tool<ImageGenerationJob>('get_image_job', { jobId, waitMs: 2000 });
      complete();
      const saved = await pending;
      assert.equal(saved.structuredContent!.status, 'succeeded');
      assert.deepEqual(await readFile(path.join(project, saved.structuredContent!.asset!.path)), PNG);
      assert.doesNotMatch(JSON.stringify(saved), new RegExp(KEY));
      assert.doesNotMatch(JSON.stringify(saved), /b64_json/);
      assert.doesNotMatch(client.stderr(), new RegExp(KEY));
    } finally { complete(); await client.stop(); }
    const reopened = await startMcp(project, data, endpoint, false);
    try {
      const tools = await reopened.rpc('tools/list') as { tools: Array<{ name: string }> };
      assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), ['get_image_job', 'list_generated_images']);
      const saved = await reopened.tool<ImageGenerationJob>('get_image_job', { requestId: INPUT.requestId });
      assert.equal(saved.structuredContent!.jobId, jobId!);
      assert.equal(saved.structuredContent!.status, 'succeeded');
      const listed = await reopened.tool<ImageGenerationJobPage>('list_generated_images', {});
      assert.equal(listed.structuredContent!.jobs.length, 1);
      assert.equal(calls(), 1);
    } finally { await reopened.stop(); }
  });
});

test('killing the MCP process after API acceptance preserves uncertainty and prevents duplicate billing requests', { timeout: 30_000 }, async () => {
  await fixture(async ({ project, data, endpoint, calls, started }) => {
    const first = await startMcp(project, data, endpoint);
    const accepted = await first.tool<ImageGenerationJob>('generate_image', INPUT);
    await started;
    await first.stop(true);
    const reopened = await startMcp(project, data, endpoint);
    try {
      const recovered = await reopened.tool<ImageGenerationJob>('get_image_job', { requestId: INPUT.requestId });
      assert.equal(recovered.structuredContent!.status, 'uncertain');
      assert.equal(recovered.isError, false);
      assert.equal(recovered.structuredContent!.jobId, accepted.structuredContent!.jobId);
      const replay = await reopened.tool<ImageGenerationJob>('generate_image', INPUT);
      assert.equal(replay.structuredContent!.status, 'uncertain');
      assert.equal(calls(), 1);
    } finally { await reopened.stop(); }
  });
});

test('MCP schema rejects attempts to change the project or provider through tool arguments', { timeout: 20_000 }, async () => {
  await fixture(async ({ project, data, endpoint, calls }) => {
    const client = await startMcp(project, data, endpoint);
    try {
      const rejected = await client.tool('generate_image', { ...INPUT, projectDirectory: '../outside', endpoint: 'https://other.invalid' });
      assert.equal(rejected.isError, true);
      assert.equal(calls(), 0);
    } finally { await client.stop(); }
  });
});
