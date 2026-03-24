import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = path.resolve(__dirname, '../locales');
const SUPPORTED_LOCALES = ['en', 'de', 'ja', 'ko', 'ru', 'zh-CN'];

/**
 * Keys that must exist in every locale's settings.json under "permissions".
 * This ensures new features like useWorktree are added to all locales.
 */
const REQUIRED_PERMISSION_KEYS = [
  'skipPermissions',
  'useWorktree',
  'allowedTools',
  'blockedTools',
];

describe('i18n locale completeness', () => {
  const localeData: Record<string, Record<string, unknown>> = {};

  // Load all locale files upfront
  for (const locale of SUPPORTED_LOCALES) {
    const filePath = path.join(LOCALES_DIR, locale, 'settings.json');
    const raw = fs.readFileSync(filePath, 'utf-8');
    localeData[locale] = JSON.parse(raw);
  }

  for (const locale of SUPPORTED_LOCALES) {
    describe(`locale: ${locale}`, () => {
      it('has a settings.json file', () => {
        expect(localeData[locale]).toBeDefined();
      });

      it('has a permissions section', () => {
        const permissions = (localeData[locale] as Record<string, unknown>).permissions;
        expect(permissions).toBeDefined();
        expect(typeof permissions).toBe('object');
      });

      for (const key of REQUIRED_PERMISSION_KEYS) {
        it(`has permissions.${key}`, () => {
          const permissions = (localeData[locale] as Record<string, Record<string, unknown>>).permissions;
          expect(permissions[key]).toBeDefined();
          expect(typeof permissions[key]).toBe('object');
        });
      }

      it('has useWorktree.label and useWorktree.description', () => {
        const permissions = (localeData[locale] as Record<string, Record<string, Record<string, string>>>).permissions;
        expect(permissions.useWorktree.label).toBeDefined();
        expect(typeof permissions.useWorktree.label).toBe('string');
        expect(permissions.useWorktree.label.length).toBeGreaterThan(0);
        expect(permissions.useWorktree.description).toBeDefined();
        expect(typeof permissions.useWorktree.description).toBe('string');
        expect(permissions.useWorktree.description.length).toBeGreaterThan(0);
      });
    });
  }
});
