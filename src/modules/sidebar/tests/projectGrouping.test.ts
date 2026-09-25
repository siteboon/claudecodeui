import assert from 'node:assert/strict';

import { test } from 'vitest';

import type { Project } from '@/shared/types';
import { getProjectGroupKey, groupProjectsByBasename } from '@/modules/sidebar/utils/sidebarProjectFormatting';

/**
 * The grouping exists for a ~/.claude synced across machines, where one project
 * folder is recorded once per absolute path. These cover the key derivation
 * across separator styles and the grouping's ordering contract; the rendering
 * lives in SidebarProjectList.
 */

const project = (projectId: string, fullPath: string): Project => ({
  projectId,
  name: projectId,
  displayName: projectId,
  fullPath,
} as Project);

test('keys a project by its trailing folder name, whatever the separator', () => {
  assert.equal(getProjectGroupKey(project('a', '/Users/sergio/ClaudeProyectos/Paperclip')), 'Paperclip');
  assert.equal(getProjectGroupKey(project('b', 'C:\\Users\\sergio\\ClaudeProyectos\\Paperclip')), 'Paperclip');
  assert.equal(getProjectGroupKey(project('c', '/home/claude/ClaudeProyectos/Paperclip/')), 'Paperclip');
});

test('falls back to the display name when there is no path to read', () => {
  assert.equal(getProjectGroupKey(project('d', '')), 'd');
});

test('groups the same folder reached from three machines into one entry', () => {
  const groups = groupProjectsByBasename([
    project('mac', '/Users/sergio/ClaudeProyectos/Paperclip'),
    project('win', 'C:\\Users\\sergio\\ClaudeProyectos\\Paperclip'),
    project('linux', '/home/claude/ClaudeProyectos/Paperclip'),
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].key, 'Paperclip');
  assert.deepEqual(groups[0].projects.map((p) => p.projectId), ['mac', 'win', 'linux']);
});

test('keeps the incoming sort order by first occurrence, and leaves singletons alone', () => {
  const groups = groupProjectsByBasename([
    project('zeta', '/a/zeta'),
    project('alpha-mac', '/Users/sergio/alpha'),
    project('beta', '/a/beta'),
    project('alpha-linux', '/home/claude/alpha'),
  ]);

  assert.deepEqual(groups.map((group) => group.key), ['zeta', 'alpha', 'beta']);
  assert.deepEqual(groups.map((group) => group.projects.length), [1, 2, 1]);
});
