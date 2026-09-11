import assert from 'node:assert/strict';

import { test } from 'vitest';

import {
  extractToolResultImages,
  hasToolResultImages,
  withoutImageBlocks,
} from '@/modules/chat/utils/toolResultImages';
import { getToolConfig } from '@/modules/chat/tools/configs/toolConfigs';

/**
 * Tool results that carry image blocks (screenshots, image reads, MCP image
 * content) must surface as pictures, not as a base64 wall dumped into the
 * text renderer. The extraction has to survive every shape the providers
 * actually produce — including the JSON.stringified array form that
 * useChatMessages produces for any non-string content.
 */

const base64Data = 'A'.repeat(96);

test('extracts the bare base64 source block', () => {
  const payload = [{ type: 'base64', media_type: 'image/png', data: base64Data }];
  assert.deepEqual(extractToolResultImages(payload), [
    { mediaType: 'image/png', data: base64Data },
  ]);
});

test('extracts the anthropic image content block', () => {
  const payload = [{
    type: 'image',
    source: { type: 'base64', media_type: 'image/jpeg', data: base64Data },
  }];
  assert.deepEqual(extractToolResultImages(payload), [
    { mediaType: 'image/jpeg', data: base64Data },
  ]);
});

test('extracts the MCP image block', () => {
  const payload = [{ type: 'image', mimeType: 'image/webp', data: base64Data }];
  assert.deepEqual(extractToolResultImages(payload), [
    { mediaType: 'image/webp', data: base64Data },
  ]);
});

test('extracts from a JSON-stringified array (useChatMessages format)', () => {
  const payload = JSON.stringify([
    { type: 'text', text: 'screenshot taken' },
    { type: 'base64', media_type: 'image/png', data: base64Data },
  ]);
  assert.equal(extractToolResultImages(payload).length, 1);
  assert.ok(hasToolResultImages(payload));
});

test('extracts through the tool result wrapper', () => {
  const payload = {
    content: JSON.stringify([{ type: 'base64', media_type: 'image/png', data: base64Data }]),
    isError: false,
  };
  assert.equal(extractToolResultImages(payload).length, 1);
});

test('ignores plain text and short non-image payloads', () => {
  assert.deepEqual(extractToolResultImages('{"ok": true}'), []);
  assert.deepEqual(extractToolResultImages([{ type: 'text', text: 'hello' }]), []);
  // Too short to be a real image payload — likely a false-shape object.
  assert.deepEqual(extractToolResultImages([{ type: 'base64', media_type: 'image/png', data: 'abc' }]), []);
  assert.equal(hasToolResultImages('plain output'), false);
});

test('default config keeps text and drops image base64', () => {
  const config = getToolConfig('SomeUnknownTool').result!;
  const props = config.getContentProps!({
    content: JSON.stringify([
      { type: 'text', text: '第一行' },
      { type: 'base64', media_type: 'image/png', data: base64Data },
    ]),
  });
  assert.equal(props.content, '第一行');
});

test('default config renders nothing but the image when there is no text', () => {
  const config = getToolConfig('SomeUnknownTool').result!;
  const props = config.getContentProps!({
    content: JSON.stringify([{ type: 'base64', media_type: 'image/png', data: base64Data }]),
  });
  assert.equal(props.content, '');
});

test('default config still shows plain output verbatim', () => {
  const config = getToolConfig('SomeUnknownTool').result!;
  const props = config.getContentProps!({ content: '命令输出正常文本' });
  assert.equal(props.content, '命令输出正常文本');
});

test('withoutImageBlocks removes image blocks and keeps the rest', () => {
  const blocks = [
    { type: 'text', text: '保留' },
    { type: 'base64', media_type: 'image/png', data: base64Data },
  ];
  assert.deepEqual(withoutImageBlocks(blocks), [{ type: 'text', text: '保留' }]);
  assert.deepEqual(withoutImageBlocks(JSON.stringify(blocks)), [{ type: 'text', text: '保留' }]);
  assert.equal(withoutImageBlocks('普通字符串'), '普通字符串');
});
