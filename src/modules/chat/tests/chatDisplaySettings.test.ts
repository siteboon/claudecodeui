import assert from 'node:assert/strict';

import { afterEach, beforeEach, test, vi } from 'vitest';

import { CHAT_DISPLAY_DEFAULTS, CHAT_WIDTH_CLASSES } from '@/shared/constants';

/**
 * The transcript's width and text size are settings now. Two things matter
 * beyond storing them: a user who never opens the dialog must keep the
 * transcript exactly as it was, and a stored value that means nothing (a width
 * removed in a later version, a font size that is not a number) must not be
 * able to produce a broken column.
 */

const MIRROR_STORAGE_KEY = 'user-preferences';

const seedPreferences = (preferences: Record<string, unknown>) => {
  localStorage.setItem(MIRROR_STORAGE_KEY, JSON.stringify(preferences));
};

const loadSettings = () => import('@/shared/chatDisplaySettings');

beforeEach(() => {
  // The preference store reads the mirror once, when the module loads, so the
  // seed has to happen before the settings module is imported.
  vi.resetModules();
  localStorage.clear();
});

afterEach(() => {
  vi.resetModules();
});

test('an install that never touched the settings reads as the transcript has always been', async () => {
  const { readChatDisplaySettings, chatFontScale, chatWidthClass } = await loadSettings();

  const settings = readChatDisplaySettings();

  assert.deepEqual(settings, CHAT_DISPLAY_DEFAULTS);
  assert.equal(chatWidthClass(settings.width), CHAT_WIDTH_CLASSES.normal);
  assert.equal(chatFontScale(settings.fontSize), 1);
});

test('reading never writes', async () => {
  const { readChatDisplaySettings } = await loadSettings();

  readChatDisplaySettings();

  const stored = JSON.parse(localStorage.getItem(MIRROR_STORAGE_KEY) ?? '{}');
  assert.equal(stored.chatDisplaySettings, undefined);
});

test('keeps what the user chose', async () => {
  seedPreferences({ chatDisplaySettings: { width: 'wide', fontSize: '18' } });
  const { readChatDisplaySettings, chatFontScale, chatWidthClass } = await loadSettings();

  const settings = readChatDisplaySettings();

  assert.equal(chatWidthClass(settings.width), CHAT_WIDTH_CLASSES.wide);
  assert.equal(chatFontScale(settings.fontSize), 18 / 14);
});

test('falls back rather than rendering a column it cannot size', async () => {
  // A width this version does not know — a preset renamed or dropped — and a
  // font size that is not a number. Both have to land on the default rather
  // than on `undefined`, which as a class name is a column with no cap at all.
  seedPreferences({ chatDisplaySettings: { width: 'enormous', fontSize: 'large' } });
  const { readChatDisplaySettings, chatFontScale, chatWidthClass } = await loadSettings();

  const settings = readChatDisplaySettings();

  assert.equal(settings.width, CHAT_DISPLAY_DEFAULTS.width);
  assert.equal(chatWidthClass(settings.width), CHAT_WIDTH_CLASSES.normal);
  assert.equal(chatFontScale(settings.fontSize), 1);
  assert.equal(chatFontScale('0'), 1);
});

test('a write lands where the reader looks', async () => {
  const { readChatDisplaySettings, writeChatDisplaySettings } = await loadSettings();

  writeChatDisplaySettings({ width: 'narrow', fontSize: '13' });

  assert.deepEqual(readChatDisplaySettings(), { width: 'narrow', fontSize: '13' });
});
