import test from 'node:test';
import assert from 'node:assert/strict';

import { getSessionTitle } from './getSessionTitle';
import type { ProjectSession } from '../../../../types/app';

test('getSessionTitle: customName wins over CLI summary', () => {
  const session: ProjectSession = {
    id: 'abc',
    __provider: 'claude',
    customName: 'Pinned name',
    summary: 'CLI re-wrote this after the last send',
  };
  assert.equal(getSessionTitle(session), 'Pinned name');
});

test('getSessionTitle: falls back to summary when no customName (claude)', () => {
  const session: ProjectSession = {
    id: 'abc',
    __provider: 'claude',
    summary: 'Current summary',
  };
  assert.equal(getSessionTitle(session), 'Current summary');
});

test('getSessionTitle: final claude fallback is "New Session"', () => {
  const session: ProjectSession = { id: 'abc', __provider: 'claude' };
  assert.equal(getSessionTitle(session), 'New Session');
});

test('getSessionTitle: cursor uses name when no customName', () => {
  const session: ProjectSession = {
    id: 'c1',
    __provider: 'cursor',
    name: 'Cursor named it',
    summary: 'ignored-for-cursor',
  };
  assert.equal(getSessionTitle(session), 'Cursor named it');

  const withCustom: ProjectSession = { ...session, customName: 'Pinned' };
  assert.equal(getSessionTitle(withCustom), 'Pinned');
});
