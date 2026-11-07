import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { test } from 'vitest';

/**
 * While anything on the page animates — a status dot, a spinner, the shimmer
 * on the activity pill — Chrome redraws every on-screen element that has a
 * `backdrop-filter` on every frame, even when the animation sits nowhere near
 * it. On a Retina Mac that kept the GPU at 100% for as long as anything moved;
 * removing the blur from any one of the main surfaces on its own was not
 * enough, each of them was a full-time cost.
 *
 * These surfaces are always (or for long stretches) on screen and sit over a
 * flat or near-opaque background, so the blur had nothing to show. Transient
 * overlays such as modal backdrops are not listed: they are up only briefly.
 */
const PERSISTENT_SURFACES = [
  'src/modules/sidebar/SidebarContent.tsx',
  'src/modules/sidebar/SidebarCollapsed.tsx',
  'src/modules/project-workspace/WorkspaceHeader.tsx',
  'src/modules/project-workspace/WorkspaceStateView.tsx',
  'src/modules/chat/composer/PromptInput.tsx',
  'src/modules/chat/tools/BashCommandDisplay.tsx',
  'src/modules/chat/transcript/BackgroundTasksStrip.tsx',
  'src/modules/shell/Shell.tsx',
  'src/modules/shell/TerminalShortcutsPanel.tsx',
  'src/modules/git-panel/branches/BranchesView.tsx',
];

const readSource = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');

for (const file of PERSISTENT_SURFACES) {
  test(`${file} draws no backdrop filter`, () => {
    const matches = readSource(file).match(/backdrop-blur[\w-/[\]]*|backdrop-filter\s*:|backdropFilter/g) ?? [];
    assert.deepEqual(matches, []);
  });
}

test('the activity pill keeps no filter or compositing layer once its entrance ends', () => {
  const rule = readSource('src/index.css').match(/\.chat-activity-enter\s*\{[^}]*\}/)?.[0];
  assert.ok(rule, 'the .chat-activity-enter rule exists');
  assert.doesNotMatch(rule, /will-change/);
  // `both`/`forwards` would hold the last keyframe (filter: blur(0) and a
  // transform) for the whole turn the pill is on screen.
  assert.doesNotMatch(rule, /\b(both|forwards)\b/);
});
