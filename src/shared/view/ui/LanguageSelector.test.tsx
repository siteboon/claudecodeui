import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';

const selectClassNames = (html: string) => {
  const match = html.match(/<select[^>]*class="([^"]+)"/);
  assert.ok(match, 'language selector should render a select element');
  return new Set(match[1].split(/\s+/));
};

test('regional Spanish names have enough width to remain distinguishable', async () => {
  const storedValues = new Map([['userLanguage', 'es-ES']]);
  globalThis.localStorage = {
    get length() {
      return storedValues.size;
    },
    clear: () => storedValues.clear(),
    getItem: (key) => storedValues.get(key) ?? null,
    key: (index) => [...storedValues.keys()][index] ?? null,
    removeItem: (key) => storedValues.delete(key),
    setItem: (key, value) => storedValues.set(key, value),
  };

  const [{ default: i18n }, { default: LanguageSelector }] = await Promise.all([
    import('../../../i18n/config.js'),
    import('./LanguageSelector'),
  ]);

  const renderSelector = (compact: boolean) => renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <LanguageSelector compact={compact} />
    </I18nextProvider>,
  );

  assert.ok(selectClassNames(renderSelector(false)).has('w-52'));
  assert.ok(selectClassNames(renderSelector(true)).has('min-w-52'));
});
