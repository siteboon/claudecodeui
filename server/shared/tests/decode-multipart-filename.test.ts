import assert from 'node:assert/strict';
import test from 'node:test';

import { decodeMultipartFilename } from '@/shared/utils.js';

// What multer hands over for a browser upload: busboy reads the UTF-8 bytes of
// the `filename="..."` parameter as latin1, one character per byte.
const asBusboyLatin1 = (name: string): string => Buffer.from(name, 'utf8').toString('latin1');

test('restores UTF-8 names that busboy read as latin1, in every script', () => {
  const names = [
    'Счет-фактура № 1 от 31.07.2026.docx',
    'Αρχείο σημειώσεων.txt',
    '日本語の資料.pdf',
    '한국어 문서.hwp',
    'סיכום פגישה.docx',
    'تقرير الربع.pdf',
    'नमस्ते दुनिया.txt',
    'party 🎉 plan.md',
    'café.txt',
  ];

  for (const name of names) {
    assert.equal(decodeMultipartFilename(asBusboyLatin1(name)), name);
  }
});

test('leaves names that busboy already decoded unchanged', () => {
  // An RFC 5987 `filename*=UTF-8''...` parameter arrives decoded; reading it
  // back as latin1 bytes would garble it.
  assert.equal(decodeMultipartFilename('Счет-фактура № 1.docx'), 'Счет-фактура № 1.docx');
  assert.equal(decodeMultipartFilename('notes 🎉.md'), 'notes 🎉.md');
  // Mixed latin1 + Greek: re-reading the low bytes would even be valid UTF-8
  // (`ɻ.txt`), so only the "already decoded" check keeps this name intact.
  assert.equal(decodeMultipartFilename('Éλ.txt'), 'Éλ.txt');
});

test('keeps a genuine latin1 name whose bytes are not valid UTF-8', () => {
  // `filename*=ISO-8859-1''caf%E9.txt` arrives as `café.txt`; the lone 0xE9
  // byte is not UTF-8, so the name must survive as sent.
  assert.equal(decodeMultipartFilename('café.txt'), 'café.txt');
  assert.equal(decodeMultipartFilename('naïve résumé.pdf'), 'naïve résumé.pdf');
});

test('keeps a leading byte order mark instead of dropping it', () => {
  // The BOM is part of the name the client sent, so it must survive the re-read.
  assert.equal(decodeMultipartFilename(asBusboyLatin1('\uFEFFСчет.txt')), '\uFEFFСчет.txt');
});

test('leaves ASCII names unchanged', () => {
  assert.equal(decodeMultipartFilename('report (final) v2.pdf'), 'report (final) v2.pdf');
  assert.equal(decodeMultipartFilename(''), '');
});
