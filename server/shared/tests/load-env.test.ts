import assert from 'node:assert/strict';
import test from 'node:test';

// Importing load-env runs its bootstrap body, so this file logs one "No .env
// file found" line when the repo has no .env. Harmless: only the exported pure
// parser is under test here.
import { parseEnvironmentFileLine } from '../../load-env.js';

type Case = {
  label: string;
  line: string;
  expected: { key: string; value: string } | null;
};

const cases: Case[] = [
  { label: 'plain assignment', line: 'CONTEXT_WINDOW=160000', expected: { key: 'CONTEXT_WINDOW', value: '160000' } },
  { label: 'double-quoted value', line: 'CLOUDCLI_DISABLE_UPDATE_CHECK="true"', expected: { key: 'CLOUDCLI_DISABLE_UPDATE_CHECK', value: 'true' } },
  { label: 'single-quoted value', line: "CLOUDCLI_DISABLE_UPDATE_CHECK='true'", expected: { key: 'CLOUDCLI_DISABLE_UPDATE_CHECK', value: 'true' } },
  { label: 'spaces around the separator', line: 'CLOUDCLI_DISABLE_UPDATE_CHECK = true', expected: { key: 'CLOUDCLI_DISABLE_UPDATE_CHECK', value: 'true' } },
  { label: 'empty double-quoted value is empty, not two quote characters', line: 'NO_UPDATE_NOTIFIER=""', expected: { key: 'NO_UPDATE_NOTIFIER', value: '' } },
  { label: 'unquoted empty value', line: 'NO_UPDATE_NOTIFIER=', expected: { key: 'NO_UPDATE_NOTIFIER', value: '' } },
  { label: 'value containing an equals sign is kept whole', line: 'TOKEN=abc=def==', expected: { key: 'TOKEN', value: 'abc=def==' } },
  { label: 'unmatched leading quote is left alone', line: 'TOKEN="abc', expected: { key: 'TOKEN', value: '"abc' } },
  { label: 'inner quotes are left alone', line: 'JSON={"a":1}', expected: { key: 'JSON', value: '{"a":1}' } },
  { label: 'comment line', line: '# CLOUDCLI_DISABLE_UPDATE_CHECK=true', expected: null },
  { label: 'blank line', line: '   ', expected: null },
  { label: 'line with no separator', line: 'CLOUDCLI_DISABLE_UPDATE_CHECK', expected: null },
  { label: 'line with no key', line: '=true', expected: null },
];

for (const testCase of cases) {
  test(`parseEnvironmentFileLine: ${testCase.label}`, () => {
    assert.deepEqual(parseEnvironmentFileLine(testCase.line), testCase.expected);
  });
}
