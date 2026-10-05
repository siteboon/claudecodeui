import assert from 'node:assert/strict';
import test from 'node:test';

import { readUploadMaxFileSizeMegabytes } from '@/shared/utils.js';

const read = (value?: string) => readUploadMaxFileSizeMegabytes(
  value === undefined ? {} : { UPLOAD_MAX_FILE_SIZE_MB: value },
);

test('upload size cap defaults to 200 MB, without a warning, when the variable is unset or blank', (t) => {
  const warn = t.mock.method(console, 'warn', () => undefined);

  for (const value of [undefined, '', '   ']) {
    assert.deepEqual(read(value), { megabytes: 200, configuredValue: null, warning: null }, JSON.stringify(value));
  }

  assert.equal(warn.mock.callCount(), 0);
});

test('upload size cap accepts whole megabytes up to the largest safe byte count', (t) => {
  const warn = t.mock.method(console, 'warn', () => undefined);

  assert.deepEqual(read('300'), { megabytes: 300, configuredValue: '300', warning: null });
  assert.deepEqual(read(' 2048 '), { megabytes: 2048, configuredValue: '2048', warning: null });
  assert.equal(read('50').megabytes, 50);
  assert.equal(read('1').megabytes, 1);
  // 8589934591 MB x 1024 x 1024 = 2^53 - 2^20 bytes, the last count that is still a safe integer.
  assert.equal(read('8589934591').megabytes, 8589934591);
  assert.equal(read('8589934591').warning, null);

  assert.equal(warn.mock.callCount(), 0);
});

test('upload size cap falls back to 200 MB with a warning for anything but plain digits in range', (t) => {
  const warn = t.mock.method(console, 'warn', () => undefined);
  const invalidValues = [
    '0', '-5', '+5', '1.5', '1GB', '300MB', 'abc', '1e3', '"300"', "'300'", '300 # comment',
    '8589934592', '9007199254740991',
  ];

  for (const value of invalidValues) {
    const setting = read(value);
    assert.equal(setting.megabytes, 200, value);
    assert.equal(setting.configuredValue, value, value);
    assert.match(String(setting.warning), /^\[WARN\] Ignoring UPLOAD_MAX_FILE_SIZE_MB=/, value);
  }

  assert.equal(
    read('1GB').warning,
    '[WARN] Ignoring UPLOAD_MAX_FILE_SIZE_MB="1GB": expected a positive whole number of megabytes '
    + '(digits only, no quotes or units, at most 8589934591). Using 200MB.',
  );
  // Reporting is the caller's job (the File Tree module logs it once at startup).
  assert.equal(warn.mock.callCount(), 0);
});
