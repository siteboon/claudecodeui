import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveQoderPermissionOptions } from '@/modules/providers/list/qoder/qoder-permissions.provider.js';

test('default mode without tools settings produces no permission flags', () => {
  assert.deepEqual(resolveQoderPermissionOptions('default'), { args: [], env: {} });
  assert.deepEqual(resolveQoderPermissionOptions(null), { args: [], env: {} });
  assert.deepEqual(resolveQoderPermissionOptions(undefined, undefined), { args: [], env: {} });
});

test('bypassPermissions maps onto qodercli bypass_permissions mode', () => {
  assert.deepEqual(
    resolveQoderPermissionOptions('bypassPermissions').args,
    ['--permission-mode', 'bypass_permissions'],
  );
});

test('acceptEdits maps onto qodercli accept_edits mode', () => {
  assert.deepEqual(
    resolveQoderPermissionOptions('acceptEdits').args,
    ['--permission-mode', 'accept_edits'],
  );
});

test('skipPermissions from tools settings forces bypass_permissions', () => {
  assert.deepEqual(
    resolveQoderPermissionOptions('default', { skipPermissions: true }).args,
    ['--permission-mode', 'bypass_permissions'],
  );
});

test('allowed and disallowed tools map onto repeated CLI flags', () => {
  const { args } = resolveQoderPermissionOptions('default', {
    allowedTools: ['Bash(git log:*)', 'Read'],
    disallowedTools: ['Bash(rm:*)'],
  });

  assert.deepEqual(args, [
    '--allowed-tools', 'Bash(git log:*)',
    '--allowed-tools', 'Read',
    '--disallowed-tools', 'Bash(rm:*)',
  ]);
});

test('blank tool entries are skipped', () => {
  const { args } = resolveQoderPermissionOptions('default', {
    allowedTools: ['  '],
    disallowedTools: [''],
  });

  assert.deepEqual(args, []);
});
