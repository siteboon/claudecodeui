import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import csVoice from '@/modules/chat/voice/locales/cs/voice.json';
import enVoice from '@/modules/chat/voice/locales/en/voice.json';
import { SERVICE_ERROR_CODES } from '@/modules/chat/voice/voiceErrors';

/**
 * The voice overlay's own coverage check: every `voice` key the code asks for
 * exists in BOTH languages, the two files carry the same keys, and the Czech copy
 * is actually Czech. A missing `cs` key fails here - i18next would otherwise fall
 * back to English without a sound.
 */

const flatten = (value: unknown, prefix = ''): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object') Object.assign(out, flatten(child, name));
    else out[name] = String(child);
  }
  return out;
};

const en = flatten(enVoice);
const cs = flatten(csVoice);

// Every file that asks for a `voice` string, and the call shapes it asks with.
const SOURCES = [
  'src/modules/chat/voice',
  'src/modules/chat/composer/ChatComposer.tsx',
  'src/modules/chat/composer/VoiceInputButton.tsx',
  'src/modules/chat/hooks/useVoiceInput.ts',
  'src/modules/chat/hooks/useChatComposerState.ts',
  'src/modules/chat/transcript/MessageSpeakControl.tsx',
  'src/modules/settings/tabs/VoiceSettingsTab.tsx',
];

function sourceFiles(): string[] {
  const files: string[] = [];
  for (const entry of SOURCES) {
    const full = path.resolve(process.cwd(), entry);
    if (fs.statSync(full).isDirectory()) {
      for (const name of fs.readdirSync(full)) {
        if (/\.tsx?$/.test(name) && !name.includes('.test.')) files.push(path.join(full, name));
      }
    } else {
      files.push(full);
    }
  }
  return files;
}

function keysUsedInCode(): Set<string> {
  const used = new Set<string>();
  const shapes = [
    /tVoice\(\s*'([a-zA-Z]+\.[a-zA-Z_]+)'/g,
    /announceVoice\(\s*'([a-zA-Z]+\.[a-zA-Z_]+)'/g,
    /onError\?\.\(\s*'([a-zA-Z]+\.[a-zA-Z_]+)'/g,
    /clearVoiceAnnouncement\(\s*'([a-zA-Z]+\.[a-zA-Z_]+)'/g,
  ];
  for (const file of sourceFiles()) {
    const text = fs.readFileSync(file, 'utf8');
    for (const shape of shapes) for (const match of text.matchAll(shape)) used.add(match[1]);
    // Inside the overlay's own components `t` is the voice translator.
    if (file.includes(`${path.sep}voice${path.sep}`) && text.includes('useTranslation(VOICE_NS)')) {
      for (const match of text.matchAll(/\bt\(\s*'([a-zA-Z]+\.[a-zA-Z_]+)'/g)) used.add(match[1]);
    }
  }
  for (const code of [...SERVICE_ERROR_CODES, 'network', 'generic']) used.add(`errors.${code}`);
  for (const kind of ['policyBlocked', 'denied', 'busy', 'notFound']) used.add(`dictation.${kind}`);
  return used;
}

describe('voice locales', () => {
  test('en and cs carry exactly the same keys, none empty', () => {
    expect(Object.keys(cs).sort()).toEqual(Object.keys(en).sort());
    for (const [key, value] of Object.entries(cs)) expect(value.trim(), `cs:${key}`).not.toBe('');
  });

  test('every key the code asks for exists in both languages', () => {
    const used = keysUsedInCode();
    expect(used.size).toBeGreaterThan(30);
    const missing = [...used].filter((key) => !(key in en) || !(key in cs));
    expect(missing).toEqual([]);
  });

  test('the Czech copy is Czech, not a copy of the English', () => {
    const same = Object.keys(cs).filter((key) => cs[key] === en[key]);
    expect(same).toEqual([]);
  });

  test('error and dictation copy carries no status code, vendor name or technical word', () => {
    for (const [key, value] of Object.entries(cs)) {
      if (!key.startsWith('errors.') && !key.startsWith('dictation.')) continue;
      expect(value, key).not.toMatch(/\b\d{3}\b|ElevenLabs|Azure|OpenAI|HTTP|API|status|error/i);
    }
  });
});
