import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const LOGO_DIR = path.resolve('src/components/llm-logo-provider');

test('OpenClaudeLogo.tsx exists', () => {
  assert.ok(fs.existsSync(path.join(LOGO_DIR, 'OpenClaudeLogo.tsx')), 'OpenClaudeLogo.tsx should exist');
});

test('CrewAILogo.tsx exists', () => {
  assert.ok(fs.existsSync(path.join(LOGO_DIR, 'CrewAILogo.tsx')), 'CrewAILogo.tsx should exist');
});

test('SessionProviderLogo handles openclaude provider', () => {
  const source = fs.readFileSync(path.join(LOGO_DIR, 'SessionProviderLogo.tsx'), 'utf8');
  assert.ok(source.includes('openclaude'), 'SessionProviderLogo should handle openclaude');
  assert.ok(source.includes('OpenClaudeLogo'), 'SessionProviderLogo should import OpenClaudeLogo');
});

test('SessionProviderLogo handles crewai provider', () => {
  const source = fs.readFileSync(path.join(LOGO_DIR, 'SessionProviderLogo.tsx'), 'utf8');
  assert.ok(source.includes('crewai'), 'SessionProviderLogo should handle crewai');
  assert.ok(source.includes('CrewAILogo'), 'SessionProviderLogo should import CrewAILogo');
});
