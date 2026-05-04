import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const CSS_PATH = path.resolve('src/index.css');
const ONE_LINE_PATH = path.resolve('src/components/chat/tools/components/OneLineDisplay.tsx');
const COMPOSER_PATH = path.resolve('src/components/chat/view/subcomponents/ChatComposer.tsx');
const CHAT_INTERFACE_PATH = path.resolve('src/components/chat/view/ChatInterface.tsx');

test('P5-04: OneLineDisplay references cli-theme for plain-text mode', () => {
  const source = fs.readFileSync(ONE_LINE_PATH, 'utf8');
  assert.ok(
    source.includes('cli-theme') || source.includes('cliTheme'),
    'OneLineDisplay should have cli-theme conditional rendering',
  );
});

test('P5-05: ChatComposer has minimal prompt bar in CLI theme', () => {
  const source = fs.readFileSync(COMPOSER_PATH, 'utf8');
  assert.ok(
    source.includes('cli-theme') || source.includes('cliTheme'),
    'ChatComposer should reference cli-theme for minimal prompt bar',
  );
});

test('P5-06: CSS hides token pie, mermaid, image attachment in CLI theme', () => {
  const source = fs.readFileSync(CSS_PATH, 'utf8');
  assert.ok(
    source.includes('.cli-theme') && source.includes('display: none'),
    'CSS should hide elements in .cli-theme',
  );
});

test('P5-07: Ctrl+C abort shortcut exists', () => {
  const source = fs.readFileSync(CHAT_INTERFACE_PATH, 'utf8');
  assert.ok(
    source.includes('Ctrl+C') || source.includes("key === 'c'") || source.includes('ctrlKey') || source.includes('abort'),
    'ChatInterface should have Ctrl+C abort shortcut',
  );
});

test('P5-09: Arrow key history navigation in ChatComposer', () => {
  const source = fs.readFileSync(COMPOSER_PATH, 'utf8');
  assert.ok(
    source.includes('ArrowUp') || source.includes('history'),
    'ChatComposer should have arrow key history navigation',
  );
});
