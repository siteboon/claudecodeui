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

  for (const locale of SUPPORTED_LOCALES) {
    describe(`locale: ${locale}`, () => {
      const filePath = path.join(LOCALES_DIR, locale, 'settings.json');

      it('has a settings.json file', () => {
        expect(fs.existsSync(filePath)).toBe(true);
      });

      it('has valid settings.json content', () => {
        expect(() => {
          const raw = fs.readFileSync(filePath, 'utf-8');
          localeData[locale] = JSON.parse(raw);
        }).not.toThrow();
      });

      it('has a permissions section', () => {
        const root = localeData[locale] as Record<string, unknown>;
        expect(root).toBeDefined();
        const permissions = root?.permissions;
        expect(permissions).toBeDefined();
        expect(typeof permissions).toBe('object');
      });

      for (const key of REQUIRED_PERMISSION_KEYS) {
        it(`has permissions.${key}`, () => {
          const root = localeData[locale] as Record<string, unknown>;
          expect(root).toBeDefined();
          const permissions = root?.permissions as Record<string, unknown> | undefined;
          expect(permissions).toBeDefined();
          const section = permissions?.[key];
          expect(section).toBeDefined();
          expect(typeof section).toBe('object');
        });
      }

      it('has useWorktree.label and useWorktree.description', () => {
        const root = localeData[locale] as Record<string, unknown>;
        expect(root).toBeDefined();
        const permissions = root?.permissions as Record<string, unknown> | undefined;
        expect(permissions).toBeDefined();
        const useWorktree = permissions?.useWorktree as Record<string, unknown> | undefined;
        expect(useWorktree).toBeDefined();
        expect(typeof useWorktree?.label).toBe('string');
        expect((useWorktree?.label as string).length).toBeGreaterThan(0);
        expect(typeof useWorktree?.description).toBe('string');
        expect((useWorktree?.description as string).length).toBeGreaterThan(0);
      });
    });
  }
});
