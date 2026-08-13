import assert from 'node:assert/strict';
import test from 'node:test';

import { buildQoderArgs } from '@/modules/providers/list/qoder/qoder-runtime.provider.js';

const baseOptions = {
  resolvedModel: undefined,
  resolvedEffort: undefined,
  workingDir: '/home/user/project',
  providerSessionId: undefined,
  images: undefined,
  files: undefined,
  command: 'hello world',
  permissionMode: 'default',
  toolsSettings: undefined,
};

test('buildQoderArgs: basic prompt with default mode has no -- separator', () => {
  const args = buildQoderArgs(baseOptions);
  assert.deepEqual(args, [
    '-p', '--output-format', 'stream-json',
    '-w', '/home/user/project',
    'hello world',
  ]);
});

test('buildQoderArgs: resolved model is inserted before the prompt', () => {
  const args = buildQoderArgs({ ...baseOptions, resolvedModel: 'Ultimate' });
  assert.deepEqual(args, [
    '-p', '--output-format', 'stream-json',
    '-w', '/home/user/project',
    '-m', 'Ultimate',
    'hello world',
  ]);
});

test('buildQoderArgs: literal "default" model is dropped, not passed to the CLI', () => {
  const args = buildQoderArgs({ ...baseOptions, resolvedModel: 'default' });
  assert.equal(args.includes('-m'), false);
});

test('buildQoderArgs: effort follows model flag', () => {
  const args = buildQoderArgs({
    ...baseOptions,
    resolvedModel: 'Ultimate',
    resolvedEffort: 'high',
  });
  assert.deepEqual(args, [
    '-p', '--output-format', 'stream-json',
    '-w', '/home/user/project',
    '-m', 'Ultimate',
    '--reasoning-effort', 'high',
    'hello world',
  ]);
});

test('buildQoderArgs: --resume is added when providerSessionId is set', () => {
  const args = buildQoderArgs({ ...baseOptions, providerSessionId: 'abc-123' });
  assert.deepEqual(args, [
    '-p', '--output-format', 'stream-json',
    '-w', '/home/user/project',
    '--resume', 'abc-123',
    'hello world',
  ]);
});

test('buildQoderArgs: bypassPermissions adds --permission-mode bypass_permissions', () => {
  const args = buildQoderArgs({ ...baseOptions, permissionMode: 'bypassPermissions' });
  assert.deepEqual(args, [
    '-p', '--output-format', 'stream-json',
    '-w', '/home/user/project',
    '--permission-mode', 'bypass_permissions',
    'hello world',
  ]);
});

test('buildQoderArgs: restrictedTools produce --tools then -- separator then prompt', () => {
  const args = buildQoderArgs({
    ...baseOptions,
    toolsSettings: { restrictedTools: ['Read', 'Grep'] },
  });
  assert.deepEqual(args, [
    '-p', '--output-format', 'stream-json',
    '-w', '/home/user/project',
    '--tools', 'Read', 'Grep',
    '--',
    'hello world',
  ]);
});

test('buildQoderArgs: --attachment comes before --tools so the variadic list stays intact', () => {
  const args = buildQoderArgs({
    ...baseOptions,
    files: ['/path/to/file.ts'],
    toolsSettings: { restrictedTools: ['Read'] },
  });

  const attachmentIndex = args.indexOf('--attachment');
  const toolsIndex = args.indexOf('--tools');
  const separatorIndex = args.indexOf('--');

  assert.ok(attachmentIndex > -1, 'expected --attachment');
  assert.ok(toolsIndex > attachmentIndex, '--attachment must come before --tools');
  assert.ok(separatorIndex > toolsIndex, '--tools must come before --');
  assert.ok(args[separatorIndex + 1].includes('hello world'), 'prompt must contain the original text');
});

test('buildQoderArgs: files without command still produce a prompt with files_input tag', () => {
  const args = buildQoderArgs({
    ...baseOptions,
    command: undefined,
    files: ['/path/to/file.ts'],
  });

  const lastArg = args.at(-1);
  assert.ok(lastArg, 'expected a prompt argument');
  assert.ok(lastArg.includes('<files_input>'), 'prompt must contain files_input tag');
  assert.ok(lastArg.includes('/path/to/file.ts'), 'prompt must contain the file path');
});

test('buildQoderArgs: images produce --attachment and an images_input tag', () => {
  const args = buildQoderArgs({
    ...baseOptions,
    command: undefined,
    images: ['/path/to/image.png'],
  });

  const attachmentIndex = args.indexOf('--attachment');
  assert.ok(attachmentIndex > -1, 'expected --attachment');
  assert.equal(args[attachmentIndex + 1], '/path/to/image.png');

  const lastArg = args.at(-1);
  assert.ok(lastArg, 'expected a prompt argument');
  assert.ok(lastArg.includes('<images_input>'), 'prompt must contain images_input tag');
  assert.ok(lastArg.includes('/path/to/image.png'), 'prompt must contain the image path');
});

test('buildQoderArgs: no prompt and no files means no -- separator and no prompt arg', () => {
  const args = buildQoderArgs({
    ...baseOptions,
    command: undefined,
    files: undefined,
  });

  assert.equal(args.includes('--'), false);
  assert.equal(args.at(-1), '/home/user/project');
});
