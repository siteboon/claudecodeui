import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getLanguage,
  getLanguageValues,
  isLanguageSupported,
  languages,
} from './languages.js';

test('lists Spain and Latin American Spanish as adjacent, distinct options', () => {
  const spanishFromSpain = {
    value: 'es-ES',
    label: 'Spanish (Spain)',
    nativeName: 'Español (España)',
  };
  const latinAmericanSpanish = {
    value: 'es-419',
    label: 'Spanish (Latin America)',
    nativeName: 'Español (Latinoamérica)',
  };

  const spainIndex = languages.findIndex(({ value }) => value === spanishFromSpain.value);
  const latinAmericaIndex = languages.findIndex(({ value }) => value === latinAmericanSpanish.value);

  assert.notEqual(spainIndex, -1);
  assert.equal(latinAmericaIndex, spainIndex + 1);
  assert.deepEqual(languages[spainIndex], spanishFromSpain);
  assert.deepEqual(languages[latinAmericaIndex], latinAmericanSpanish);
});

test('language helpers preserve the two regional Spanish codes', () => {
  assert.equal(getLanguage('es-ES')?.nativeName, 'Español (España)');
  assert.equal(getLanguage('es-419')?.nativeName, 'Español (Latinoamérica)');
  assert.equal(isLanguageSupported('es-ES'), true);
  assert.equal(isLanguageSupported('es-419'), true);
  assert.equal(isLanguageSupported('es'), false);
  assert.ok(getLanguageValues().includes('es-ES'));
  assert.ok(getLanguageValues().includes('es-419'));
});
