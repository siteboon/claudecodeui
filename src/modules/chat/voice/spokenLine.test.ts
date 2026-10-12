import { describe, expect, test } from 'vitest';

import { extractSpokenLine, stripSpokenBlocks, type SpokenLineResult } from '@/modules/chat/voice/spokenLine';

const reasonOf = (result: SpokenLineResult) => (result.status === 'rejected' ? result.reason : null);

describe('extractSpokenLine', () => {
  test('extracts a trailing block', () => {
    const reply = 'Upravil jsem komponentu.\n\n<spoken>Hotovo, tlačítko už funguje.</spoken>\n';
    expect(extractSpokenLine(reply)).toEqual({ status: 'valid', line: 'Hotovo, tlačítko už funguje.' });
  });

  test('takes the LAST block when the reply quotes an earlier one', () => {
    const reply = 'První <spoken>stará věta</spoken> a pak.\n<spoken>Nová věta.</spoken>';
    expect(extractSpokenLine(reply)).toEqual({ status: 'valid', line: 'Nová věta.' });
  });

  test('collapses whitespace inside the block', () => {
    expect(extractSpokenLine('<spoken>  Dvě\n  věty.   Konec.  </spoken>').line).toBe('Dvě věty. Konec.');
  });

  test('rejects a block followed by more text', () => {
    const reply = '<spoken>Hotovo.</spoken>\nA ještě jedna poznámka.';
    expect(extractSpokenLine(reply)).toEqual({ status: 'rejected', line: null, reason: 'trailing_text' });
  });

  test('rejects a block with a fenced code fragment', () => {
    expect(reasonOf(extractSpokenLine('<spoken>Spusť ```npm test``` znovu.</spoken>'))).toBe('code');
    expect(reasonOf(extractSpokenLine('<spoken>Spusť `npm test` znovu.</spoken>'))).toBe('code');
  });

  test('rejects a path', () => {
    expect(reasonOf(extractSpokenLine('<spoken>Změnil jsem src/app.ts.</spoken>'))).toBe('path');
    expect(reasonOf(extractSpokenLine('<spoken>Soubor C:\\temp je pryč.</spoken>'))).toBe('path');
    expect(reasonOf(extractSpokenLine('<spoken>Upravil jsem index.tsx podle zadání.</spoken>'))).toBe('path');
  });

  test('rejects a digit sequence', () => {
    expect(reasonOf(extractSpokenLine('<spoken>Prošlo 42 testů.</spoken>'))).toBe('digits');
    expect(extractSpokenLine('<spoken>Prošlo dvaačtyřicet testů.</spoken>').status).toBe('valid');
  });

  test('rejects an empty and an overlong block', () => {
    expect(reasonOf(extractSpokenLine('<spoken>   </spoken>'))).toBe('empty');
    expect(reasonOf(extractSpokenLine(`<spoken>${'slovo '.repeat(80)}</spoken>`))).toBe('too_long');
  });

  test('returns none for a reply without a block', () => {
    expect(extractSpokenLine('Jen text bez shrnutí.')).toEqual({ status: 'missing', line: null });
    expect(extractSpokenLine('')).toEqual({ status: 'missing', line: null });
  });

  test('an unclosed block is not a spoken line', () => {
    expect(extractSpokenLine('Text <spoken>nedopsané').status).toBe('missing');
  });
});

describe('stripSpokenBlocks', () => {
  test('removes the block and its text from display', () => {
    const reply = 'Upravil jsem komponentu.\n\n<spoken>Hotovo, tlačítko už funguje.</spoken>\n';
    const shown = stripSpokenBlocks(reply);
    expect(shown).toBe('Upravil jsem komponentu.');
    expect(shown).not.toContain('spoken');
    expect(shown).not.toContain('Hotovo');
  });

  test('a rejected block is stripped too', () => {
    const shown = stripSpokenBlocks('Výsledek.\n<spoken>Prošlo 42 testů.</spoken>\nDovětek.');
    expect(shown).toBe('Výsledek.\n\nDovětek.');
  });

  test('a reply without a block is returned unchanged', () => {
    const reply = 'Beze změny.\n\n```ts\nconst a = 1;\n```\n';
    expect(stripSpokenBlocks(reply)).toBe(reply);
  });

  test('a tag mentioned in inline code or in a sentence is text, not a block', () => {
    const mention = 'Použij značku `<spoken>` na konci odpovědi, pak pokračuj.';
    expect(stripSpokenBlocks(mention)).toBe(mention);
    expect(stripSpokenBlocks(mention, { streaming: true })).toBe(mention);
    const quoted = 'Blok vypadá takto: `<spoken>Hotovo.</spoken>` a patří na konec.';
    expect(stripSpokenBlocks(quoted)).toBe(quoted);
    const sentence = 'Značku <spoken> píšu jen na konec.';
    expect(stripSpokenBlocks(sentence)).toBe(sentence);
  });

  test('a block quoted inside a code fence is left alone', () => {
    const reply = 'Příklad:\n```\n<spoken>ukázka</spoken>\n```\nKonec.';
    expect(stripSpokenBlocks(reply)).toBe(reply);
  });

  test('streaming: an unclosed block shows nothing of the tag', () => {
    expect(stripSpokenBlocks('Hotovo.\n<spoken>Kompo', { streaming: true })).toBe('Hotovo.');
  });

  test('streaming: a half-written opening tag at the end is hidden', () => {
    for (const partial of ['<', '<s', '<spo', '<spoken']) {
      expect(stripSpokenBlocks(`Hotovo.\n${partial}`, { streaming: true })).toBe('Hotovo.');
    }
  });

  test('finished reply: a literal "<s" at the end is kept, an unclosed block is not', () => {
    expect(stripSpokenBlocks('a <s')).toBe('a <s');
    expect(stripSpokenBlocks('Hotovo.\n<spoken>nedopsané')).toBe('Hotovo.');
  });
});
