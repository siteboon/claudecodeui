import assert from 'node:assert/strict';
import test from 'node:test';

import { getUpdateCheckOptOutVariable, isUpdateCheckDisabled } from '@/shared/utils.js';

type Case = {
  label: string;
  environment: NodeJS.ProcessEnv;
  /** The variable expected to win, or null when update checks stay enabled. */
  source: string | null;
  warns: boolean;
};

const cases: Case[] = [
  { label: 'no variables set', environment: {}, source: null, warns: false },
  { label: 'CLOUDCLI_DISABLE_UPDATE_CHECK=true', environment: { CLOUDCLI_DISABLE_UPDATE_CHECK: 'true' }, source: 'CLOUDCLI_DISABLE_UPDATE_CHECK', warns: false },
  { label: 'CLOUDCLI_DISABLE_UPDATE_CHECK=1', environment: { CLOUDCLI_DISABLE_UPDATE_CHECK: '1' }, source: 'CLOUDCLI_DISABLE_UPDATE_CHECK', warns: false },
  { label: 'CLOUDCLI_DISABLE_UPDATE_CHECK=" TRUE "', environment: { CLOUDCLI_DISABLE_UPDATE_CHECK: ' TRUE ' }, source: 'CLOUDCLI_DISABLE_UPDATE_CHECK', warns: false },
  { label: 'CLOUDCLI_DISABLE_UPDATE_CHECK empty', environment: { CLOUDCLI_DISABLE_UPDATE_CHECK: '' }, source: null, warns: false },
  { label: 'CLOUDCLI_DISABLE_UPDATE_CHECK whitespace only', environment: { CLOUDCLI_DISABLE_UPDATE_CHECK: '   ' }, source: null, warns: false },
  { label: 'CLOUDCLI_DISABLE_UPDATE_CHECK=false', environment: { CLOUDCLI_DISABLE_UPDATE_CHECK: 'false' }, source: null, warns: true },
  { label: 'CLOUDCLI_DISABLE_UPDATE_CHECK=0', environment: { CLOUDCLI_DISABLE_UPDATE_CHECK: '0' }, source: null, warns: true },
  { label: 'CLOUDCLI_DISABLE_UPDATE_CHECK=yes', environment: { CLOUDCLI_DISABLE_UPDATE_CHECK: 'yes' }, source: null, warns: true },
  { label: 'NO_UPDATE_NOTIFIER=1', environment: { NO_UPDATE_NOTIFIER: '1' }, source: 'NO_UPDATE_NOTIFIER', warns: false },
  { label: 'NO_UPDATE_NOTIFIER=anything', environment: { NO_UPDATE_NOTIFIER: 'anything' }, source: 'NO_UPDATE_NOTIFIER', warns: false },
  { label: 'NO_UPDATE_NOTIFIER=false still disables', environment: { NO_UPDATE_NOTIFIER: 'false' }, source: 'NO_UPDATE_NOTIFIER', warns: false },
  { label: 'NO_UPDATE_NOTIFIER empty', environment: { NO_UPDATE_NOTIFIER: '' }, source: null, warns: false },
  { label: 'NO_UPDATE_NOTIFIER whitespace only', environment: { NO_UPDATE_NOTIFIER: '   ' }, source: null, warns: false },
  { label: 'NO_UPDATE_NOTIFIER wins over an unrecognized CloudCLI value', environment: { NO_UPDATE_NOTIFIER: '1', CLOUDCLI_DISABLE_UPDATE_CHECK: 'yes' }, source: 'NO_UPDATE_NOTIFIER', warns: false },
  { label: 'NO_UPDATE_NOTIFIER wins over a recognized CloudCLI value', environment: { NO_UPDATE_NOTIFIER: '1', CLOUDCLI_DISABLE_UPDATE_CHECK: 'true' }, source: 'NO_UPDATE_NOTIFIER', warns: false },
];

for (const testCase of cases) {
  test(`update-check opt-out: ${testCase.label}`, () => {
    const originalWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (message?: unknown) => {
      warnings.push(String(message));
    };

    try {
      assert.equal(getUpdateCheckOptOutVariable(testCase.environment), testCase.source);
      assert.equal(warnings.length, testCase.warns ? 1 : 0);
      if (testCase.warns) {
        assert.match(warnings[0], /Ignoring CLOUDCLI_DISABLE_UPDATE_CHECK/);
      }
      // Kept inside the swap so its warning does not leak into test output.
      assert.equal(isUpdateCheckDisabled(testCase.environment), testCase.source !== null);
    } finally {
      console.warn = originalWarn;
    }
  });
}
