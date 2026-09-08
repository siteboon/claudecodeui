import assert from 'node:assert/strict';

import { afterEach, test, vi } from 'vitest';

import {
  CHAT_BODY_FONT_SIZE_CSS_VARIABLE,
  CHAT_BODY_FONT_SIZE_STORAGE_KEY,
  DEFAULT_CHAT_BODY_FONT_SIZE,
  applyChatBodyFontSize,
  initializeChatBodyFontSize,
  normalizeChatBodyFontSize,
  persistChatBodyFontSize,
  readChatBodyFontSize,
} from '@/shared/utils';

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.removeItem(CHAT_BODY_FONT_SIZE_STORAGE_KEY);
  document.documentElement.style.removeProperty(CHAT_BODY_FONT_SIZE_CSS_VARIABLE);
});

test('normalizes chat body font sizes to the supported integer range', () => {
  assert.equal(normalizeChatBodyFontSize(undefined), DEFAULT_CHAT_BODY_FONT_SIZE);
  assert.equal(normalizeChatBodyFontSize(null), DEFAULT_CHAT_BODY_FONT_SIZE);
  assert.equal(normalizeChatBodyFontSize(''), DEFAULT_CHAT_BODY_FONT_SIZE);
  assert.equal(normalizeChatBodyFontSize('  '), DEFAULT_CHAT_BODY_FONT_SIZE);
  assert.equal(normalizeChatBodyFontSize('17.6'), 18);
  assert.equal(normalizeChatBodyFontSize(0), 1);
  assert.equal(normalizeChatBodyFontSize(8), 8);
  assert.equal(normalizeChatBodyFontSize(50), 50);
  assert.equal(normalizeChatBodyFontSize(99), 50);
});

test('reads the stored preference and falls back when storage is unavailable', () => {
  assert.equal(readChatBodyFontSize({ getItem: () => '16' }), 16);
  assert.equal(readChatBodyFontSize({ getItem: () => null }), DEFAULT_CHAT_BODY_FONT_SIZE);
  assert.equal(readChatBodyFontSize({ getItem: () => 'not-a-size' }), DEFAULT_CHAT_BODY_FONT_SIZE);
  assert.equal(readChatBodyFontSize({
    getItem: () => {
      throw new Error('storage unavailable');
    },
  }), DEFAULT_CHAT_BODY_FONT_SIZE);
});

test('initializes the default font size when the storage key is missing', () => {
  window.localStorage.removeItem(CHAT_BODY_FONT_SIZE_STORAGE_KEY);

  assert.equal(initializeChatBodyFontSize(), DEFAULT_CHAT_BODY_FONT_SIZE);
  assert.equal(
    document.documentElement.style.getPropertyValue(CHAT_BODY_FONT_SIZE_CSS_VARIABLE),
    `${DEFAULT_CHAT_BODY_FONT_SIZE}px`,
  );
});

test('reads and initializes the default font size when accessing localStorage throws', () => {
  vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
    throw new Error('storage access denied');
  });

  assert.equal(readChatBodyFontSize(), DEFAULT_CHAT_BODY_FONT_SIZE);
  assert.equal(initializeChatBodyFontSize(), DEFAULT_CHAT_BODY_FONT_SIZE);
  assert.equal(
    document.documentElement.style.getPropertyValue(CHAT_BODY_FONT_SIZE_CSS_VARIABLE),
    `${DEFAULT_CHAT_BODY_FONT_SIZE}px`,
  );
});

test('persists and applies one normalized value', () => {
  const stored = new Map<string, string>();
  const properties = new Map<string, string>();
  const storage = {
    setItem: (key: string, value: string) => stored.set(key, value),
  };
  const style = {
    setProperty: (property: string, value: string | null) => {
      properties.set(property, value ?? '');
    },
  };

  assert.equal(persistChatBodyFontSize(19, storage, style), 19);
  assert.equal(stored.get(CHAT_BODY_FONT_SIZE_STORAGE_KEY), '19');
  assert.equal(properties.get(CHAT_BODY_FONT_SIZE_CSS_VARIABLE), '19px');

  assert.equal(applyChatBodyFontSize(99, style), 50);
  assert.equal(properties.get(CHAT_BODY_FONT_SIZE_CSS_VARIABLE), '50px');
});

test('still applies the normalized font size when accessing localStorage throws', () => {
  vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
    throw new Error('storage access denied');
  });

  assert.equal(persistChatBodyFontSize(99), 50);
  assert.equal(
    document.documentElement.style.getPropertyValue(CHAT_BODY_FONT_SIZE_CSS_VARIABLE),
    '50px',
  );
});

test('still applies the font size when writing to storage throws', () => {
  const storage = {
    setItem: () => {
      throw new Error('storage write denied');
    },
  };

  assert.equal(persistChatBodyFontSize(19, storage), 19);
  assert.equal(
    document.documentElement.style.getPropertyValue(CHAT_BODY_FONT_SIZE_CSS_VARIABLE),
    '19px',
  );
});
