import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildStoredAssetFileName,
  buildStoredAttachmentRecords,
  buildStoredImageRecords,
  isAllowedImageMimeType,
  resolveAttachmentAssetFile,
  resolveImageAssetFile,
} from '@/modules/assets/services/image-assets.service.js';

const ASSETS_DIR = path.join(os.homedir(), '.cloudcli', 'assets');

// What multer hands over for a browser upload: busboy reads the UTF-8 bytes of
// the `filename="..."` parameter as latin1, one character per byte.
const asBusboyLatin1 = (name: string): string => Buffer.from(name, 'utf8').toString('latin1');

const STORED_NAME_PREFIX = /^\d+-\d+-/;

/** Returns the readable part of a stored name after checking its unique prefix. */
function storedNamePart(originalName: string): string {
  const storedName = buildStoredAssetFileName(originalName);
  assert.match(storedName, STORED_NAME_PREFIX);
  return storedName.replace(STORED_NAME_PREFIX, '');
}

test('isAllowedImageMimeType accepts image formats and rejects the rest', () => {
  assert.equal(isAllowedImageMimeType('image/png'), true);
  assert.equal(isAllowedImageMimeType('image/svg+xml'), true);
  assert.equal(isAllowedImageMimeType('application/pdf'), false);
  assert.equal(isAllowedImageMimeType('text/html'), false);
});

test('buildStoredImageRecords returns absolute posix paths in the assets dir', () => {
  const records = buildStoredImageRecords([
    { originalname: 'shot.png', filename: '123-456-shot.png', size: 42, mimetype: 'image/png' },
  ]);

  assert.equal(records.length, 1);
  assert.equal(records[0].name, 'shot.png');
  assert.equal(records[0].size, 42);
  assert.equal(records[0].mimeType, 'image/png');
  assert.equal(records[0].path, `${ASSETS_DIR.replace(/\\/g, '/')}/123-456-shot.png`);
});

test('buildStoredAttachmentRecords preserves metadata for non-image files', () => {
  const records = buildStoredAttachmentRecords([
    {
      originalname: 'requirements.pdf',
      filename: '123-456-requirements.pdf',
      size: 2048,
      mimetype: 'application/pdf',
    },
  ]);

  assert.deepEqual(records[0], {
    name: 'requirements.pdf',
    path: `${ASSETS_DIR.replace(/\\/g, '/')}/123-456-requirements.pdf`,
    size: 2048,
    mimeType: 'application/pdf',
  });
});

test('resolveImageAssetFile resolves plain filenames inside the assets dir', () => {
  const resolved = resolveImageAssetFile('123-shot.png');
  assert.equal(resolved, path.join(path.resolve(ASSETS_DIR), '123-shot.png'));
});

test('resolveImageAssetFile rejects traversal and separator attempts', () => {
  assert.equal(resolveImageAssetFile(''), null);
  assert.equal(resolveImageAssetFile('   '), null);
  assert.equal(resolveImageAssetFile('../auth.db'), null);
  assert.equal(resolveImageAssetFile('..'), null);
  assert.equal(resolveImageAssetFile('sub/dir.png'), null);
  assert.equal(resolveImageAssetFile('sub\\dir.png'), null);
  assert.equal(resolveImageAssetFile('a..b/../c.png'), null);
});

test('resolveAttachmentAssetFile uses the same direct-child boundary', () => {
  assert.equal(
    resolveAttachmentAssetFile('123-notes.txt'),
    path.join(path.resolve(ASSETS_DIR), '123-notes.txt'),
  );
  assert.equal(resolveAttachmentAssetFile('../notes.txt'), null);
});

test('buildStoredImageRecords reports the decoded original upload name', () => {
  const records = buildStoredImageRecords([
    {
      originalname: asBusboyLatin1('Счет-фактура № 1 от 31.07.2026.docx'),
      filename: '123-456-Счет-фактура___1_от_31.07.2026.docx',
      size: 30,
      mimetype: 'application/octet-stream',
    },
  ]);

  assert.equal(records[0].name, 'Счет-фактура № 1 от 31.07.2026.docx');
});

test('buildStoredAssetFileName keeps letters of every script and replaces everything else', () => {
  assert.equal(
    storedNamePart(asBusboyLatin1('Счет-фактура № 1 от 31.07.2026.docx')),
    'Счет-фактура___1_от_31.07.2026.docx',
  );
  assert.equal(storedNamePart(asBusboyLatin1('Αρχείο σημειώσεων.txt')), 'Αρχείο_σημειώσεων.txt');
  assert.equal(storedNamePart(asBusboyLatin1('日本語の資料.pdf')), '日本語の資料.pdf');
  assert.equal(storedNamePart(asBusboyLatin1('סיכום פגישה.docx')), 'סיכום_פגישה.docx');
  assert.equal(storedNamePart(asBusboyLatin1('تقرير الربع.pdf')), 'تقرير_الربع.pdf');
  // Combining marks are part of the word in scripts such as Devanagari.
  assert.equal(storedNamePart(asBusboyLatin1('नमस्ते दुनिया.txt')), 'नमस्ते_दुनिया.txt');
  assert.equal(storedNamePart(asBusboyLatin1('party 🎉 plan.md')), 'party___plan.md');
  // ASCII names are sanitized exactly as before.
  assert.equal(storedNamePart('report (final) v2.pdf'), 'report__final__v2.pdf');
  assert.equal(storedNamePart('$(rm -rf ~);`x`.sh'), '__rm_-rf_____x_.sh');
  assert.equal(storedNamePart('a/b\\c:d*e?f"g<h>i|j.txt'), 'a_b_c_d_e_f_g_h_i_j.txt');
  // Bidi controls could disguise the extension in a listing.
  assert.equal(storedNamePart('invoice\u202Efdp.exe'), 'invoice_fdp.exe');
});

test('buildStoredAssetFileName normalizes to NFC and never produces whitespace', () => {
  assert.equal(storedNamePart('e\u0301te\u0301.txt'), '\u00e9t\u00e9.txt');
  for (const name of ['a b\tc\u00a0d\u2028e\u3000f.txt', asBusboyLatin1('Снимок экрана 2026-07-31.png')]) {
    assert.doesNotMatch(buildStoredAssetFileName(name), /\s/);
  }
});

test('buildStoredAssetFileName caps long names below the filesystem limit and keeps the extension', () => {
  const longAscii = storedNamePart(`${'x'.repeat(240)}.txt`);
  assert.equal(longAscii, `${'x'.repeat(196)}.txt`);

  const longCyrillic = storedNamePart(asBusboyLatin1(`${'ж'.repeat(120)}.docx`));
  assert.equal(longCyrillic, `${'ж'.repeat(97)}.docx`);

  // The `<ms>-<random>-` prefix is at most 25 bytes, so stored names stay
  // well under the 255-byte NAME_MAX.
  assert.ok(Buffer.byteLength(buildStoredAssetFileName(`${'日'.repeat(100)}.pdf`)) <= 225);

  // A long tail after the last dot is not an extension worth keeping whole.
  const longTail = storedNamePart(`${'x'.repeat(10)}.${'y'.repeat(250)}`);
  assert.equal(longTail, `${'x'.repeat(10)}.${'y'.repeat(189)}`);
});

test('buildStoredAssetFileName never splits a character when it truncates', () => {
  // Cyrillic letter + two combining marks = one 6-byte character; a cut by
  // bytes or code points would separate the marks from their letter.
  const marked = 'ж\u0301\u0308';
  assert.equal(storedNamePart(`${marked.repeat(40)}.txt`), `${marked.repeat(32)}.txt`);

  // CJK Extension B letters are surrogate pairs in JavaScript strings.
  const astral = storedNamePart(`a${'𠀀'.repeat(60)}.txt`);
  assert.equal(astral, `a${'𠀀'.repeat(48)}.txt`);
  assert.equal(Buffer.from(astral, 'utf8').toString('utf8'), astral);
});

test('buildStoredAssetFileName collapses dot runs so the asset routes can serve the file', () => {
  assert.equal(storedNamePart('a..b...pdf'), 'a.b.pdf');
  // A cut that ends right after a dot must not leave `..` before the extension.
  assert.equal(storedNamePart(`${'a'.repeat(195)}.bbbbbbb.pdf`), `${'a'.repeat(195)}.pdf`);

  for (const name of ['a..b.pdf', `${'a'.repeat(195)}.bbbbbbb.pdf`, asBusboyLatin1('Счет..docx')]) {
    assert.notEqual(resolveImageAssetFile(buildStoredAssetFileName(name)), null);
  }
});
