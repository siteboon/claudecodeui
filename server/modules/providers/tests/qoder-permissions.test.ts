import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveQoderPermissionOptions } from '@/modules/providers/list/qoder/qoder-permissions.provider.js';

test('default mode without tools settings produces no permission flags', () => {
  const noFlags = { args: [], requiresPromptSeparator: false };
  assert.deepEqual(resolveQoderPermissionOptions('default'), noFlags);
  assert.deepEqual(resolveQoderPermissionOptions(null), noFlags);
  assert.deepEqual(resolveQoderPermissionOptions(undefined, undefined), noFlags);
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

test('restrictedTools collapse into a single variadic --tools flag', () => {
  const { args, requiresPromptSeparator } = resolveQoderPermissionOptions('default', {
    restrictedTools: ['Read', 'Grep', 'Glob'],
  });

  assert.deepEqual(args, ['--tools', 'Read', 'Grep', 'Glob']);
  assert.equal(requiresPromptSeparator, true);
});

test('--tools trails the other permission flags so the variadic list stays intact', () => {
  const { args } = resolveQoderPermissionOptions('acceptEdits', {
    allowedTools: ['Bash'],
    disallowedTools: ['Write'],
    restrictedTools: ['Read'],
  });

  assert.deepEqual(args, [
    '--permission-mode', 'accept_edits',
    '--allowed-tools', 'Bash',
    '--disallowed-tools', 'Write',
    '--tools', 'Read',
  ]);
});

test('blank or empty restrictedTools produce no --tools flag and no prompt separator', () => {
  for (const restrictedTools of [[], ['', '   ']]) {
    const { args, requiresPromptSeparator } = resolveQoderPermissionOptions('default', {
      restrictedTools,
    });

    assert.deepEqual(args, []);
    assert.equal(requiresPromptSeparator, false);
  }
});
