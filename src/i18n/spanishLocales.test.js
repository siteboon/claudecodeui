import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const localeDirectory = join(currentDirectory, 'locales');
const englishDirectory = join(localeDirectory, 'en');
const spanishLocaleCodes = ['es-ES', 'es-419'];
const namespaceFiles = readdirSync(englishDirectory)
  .filter((fileName) => fileName.endsWith('.json'))
  .sort();

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

const flattenStrings = (value, path = [], entries = new Map()) => {
  if (typeof value === 'string') {
    entries.set(path.join('.'), value);
    return entries;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => flattenStrings(item, [...path, String(index)], entries));
    return entries;
  }

  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => {
      flattenStrings(item, [...path, key], entries);
    });
  }

  return entries;
};

const interpolationTokens = (value) => [
  ...value.matchAll(/{{\s*([^},\s]+)/g),
].map((match) => match[1]).sort();

for (const localeCode of spanishLocaleCodes) {
  test(`${localeCode} translates every namespace without losing keys or placeholders`, () => {
    const localePath = join(localeDirectory, localeCode);
    const localeFiles = readdirSync(localePath)
      .filter((fileName) => fileName.endsWith('.json'))
      .sort();

    assert.deepEqual(localeFiles, namespaceFiles);

    let translatedValues = 0;
    let totalValues = 0;

    for (const namespaceFile of namespaceFiles) {
      const englishEntries = flattenStrings(readJson(join(englishDirectory, namespaceFile)));
      const localizedEntries = flattenStrings(readJson(join(localePath, namespaceFile)));

      assert.deepEqual(
        [...localizedEntries.keys()].sort(),
        [...englishEntries.keys()].sort(),
        `${localeCode}/${namespaceFile} must preserve the English key set`,
      );

      for (const [key, englishValue] of englishEntries) {
        const localizedValue = localizedEntries.get(key);
        assert.deepEqual(
          interpolationTokens(localizedValue),
          interpolationTokens(englishValue),
          `${localeCode}/${namespaceFile}:${key} must preserve interpolation tokens`,
        );
        totalValues += 1;
        if (localizedValue !== englishValue) translatedValues += 1;
      }
    }

    assert.ok(
      translatedValues / totalValues > 0.75,
      `${localeCode} must translate the UI instead of relying on English fallback`,
    );
  });
}

test('Spain and Latin American Spanish are independently localized artifacts', () => {
  let differingValues = 0;

  for (const namespaceFile of namespaceFiles) {
    const spainEntries = flattenStrings(
      readJson(join(localeDirectory, 'es-ES', namespaceFile)),
    );
    const latinAmericaEntries = flattenStrings(
      readJson(join(localeDirectory, 'es-419', namespaceFile)),
    );

    for (const [key, spainValue] of spainEntries) {
      if (spainValue !== latinAmericaEntries.get(key)) differingValues += 1;
    }
  }

  assert.ok(
    differingValues >= 20,
    'regional Spanish bundles must contain deliberate vocabulary and grammar differences',
  );
});

test('i18next switches between the two exact regional resources', async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };

  const { default: i18n } = await import('./config.js');

  await i18n.changeLanguage('es-ES');
  assert.equal(i18n.resolvedLanguage, 'es-ES');
  assert.equal(i18n.t('tabs.computer', { ns: 'common' }), 'Ordenador');

  await i18n.changeLanguage('es-419');
  assert.equal(i18n.resolvedLanguage, 'es-419');
  assert.equal(i18n.t('tabs.computer', { ns: 'common' }), 'Computadora');
});
