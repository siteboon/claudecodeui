import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const SIDEBAR_FOOTER_PATH = path.resolve('src/components/sidebar/view/subcomponents/SidebarFooter.tsx');

test('P6-05: SidebarFooter references stack health', () => {
  const source = fs.readFileSync(SIDEBAR_FOOTER_PATH, 'utf8');
  assert.ok(
    source.includes('stack') || source.includes('health') || source.includes('StackHealth'),
    'SidebarFooter should have stack health indicator',
  );
});
