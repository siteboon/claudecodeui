import assert from 'node:assert/strict';

import { fireEvent, render } from '@testing-library/react';
import { test } from 'vitest';

import '@/modules/i18n';
import type { PendingPermissionRequest } from '@/shared/types';
import PermissionRequestsBanner from '@/modules/chat/composer/PermissionRequestsBanner';

/**
 * OpenCode asks through the same banner and question panel as Claude but
 * answers in its own vocabulary: "Always allow" is OpenCode's own `always`,
 * never Claude's saved allow rules; a question is answered with one list of
 * labels per question; and Dismiss rejects the question instead of skipping it.
 */

type Decision = { ids: string | string[]; decision: Record<string, unknown> };

// Element checks compare booleans: a failing `assert.equal(element, null)` makes
// node:assert print the jsdom element, whose object graph exhausts memory.
const renderBanner = (requests: PendingPermissionRequest[], providerLabel: string) => {
  const decisions: Decision[] = [];
  const grants: unknown[] = [];
  const view = render(
    <PermissionRequestsBanner
      pendingPermissionRequests={requests}
      providerLabel={providerLabel}
      handlePermissionDecision={(ids, decision) => decisions.push({ ids, decision })}
      handleGrantToolPermission={(suggestion) => {
        grants.push(suggestion);
        return { success: true };
      }}
    />,
  );
  return { ...view, decisions, grants };
};

const opencodePermission: PendingPermissionRequest = {
  requestId: 'per_1',
  toolName: 'bash',
  input: { command: 'git status', patterns: ['git status'] },
  context: { patterns: ['git status'], always: ['git status *'] },
};

const opencodeQuestion: PendingPermissionRequest = {
  requestId: 'que_1',
  toolName: 'AskUserQuestion',
  input: {
    questions: [
      {
        question: 'Which color?',
        header: 'Color',
        options: [{ label: 'Red', description: 'warm' }, { label: 'Blue', description: 'calm' }],
        multiSelect: false,
      },
      {
        question: 'Which sizes?',
        header: 'Sizes',
        options: [{ label: 'Small', description: '' }, { label: 'Large, wide', description: '' }],
        multiSelect: true,
      },
    ],
  },
  context: { answerFormat: 'label-lists' },
};

test('an OpenCode permission shows what Always allow covers and answers with OpenCode\'s always', () => {
  const { getByText, queryByText, decisions, grants } = renderBanner([opencodePermission], 'OpenCode');

  assert.ok(getByText('git status *'));
  assert.ok(getByText(/Always allow covers/));
  // Claude's allow-rule line and its settings-backed button do not apply.
  assert.equal(queryByText(/Allow rule/) === null, true);
  assert.equal(queryByText('Allow & remember') === null, true);

  fireEvent.click(getByText('Always allow'));
  assert.deepEqual(decisions, [{ ids: 'per_1', decision: { allow: true, rememberEntry: 'always' } }]);
  assert.deepEqual(grants, [], 'Always allow must not write Claude\'s allowed tools');
});

test('an OpenCode permission can be allowed once or denied', () => {
  const { getByText, decisions } = renderBanner([opencodePermission], 'OpenCode');

  fireEvent.click(getByText('Allow once'));
  fireEvent.click(getByText('Deny'));

  assert.deepEqual(decisions[0], { ids: 'per_1', decision: { allow: true } });
  assert.equal(decisions[1].ids, 'per_1');
  assert.equal(decisions[1].decision.allow, false);
});

test('a Claude permission still builds and saves its allow rule', () => {
  const { getByText, decisions, grants } = renderBanner([{
    requestId: 'claude_1',
    toolName: 'Bash',
    input: { command: 'npm test' },
  }], 'Claude');

  assert.ok(getByText('Bash(npm:*)'));
  fireEvent.click(getByText('Allow & remember'));

  assert.deepEqual(grants, [{ entry: 'Bash(npm:*)', toolName: 'Bash' }]);
  assert.deepEqual(decisions, [{ ids: ['claude_1'], decision: { allow: true, rememberEntry: 'Bash(npm:*)' } }]);
});

test('an OpenCode question is answered with one label list per question, in option order', () => {
  const { getByText, queryByText, decisions } = renderBanner([opencodeQuestion], 'OpenCode');

  assert.ok(getByText('OpenCode needs your input'));
  fireEvent.click(getByText('Red'));
  fireEvent.click(getByText('Next'));
  // Picked out of order; a label may itself contain ", ".
  fireEvent.click(getByText('Large, wide'));
  fireEvent.click(getByText('Small'));
  fireEvent.click(getByText('Submit'));

  assert.deepEqual(decisions, [{
    ids: 'que_1',
    decision: { allow: true, updatedInput: { answers: [['Red'], ['Small', 'Large, wide']] } },
  }]);
  assert.equal(queryByText('Skip all') === null, true);
});

test('an OpenCode question is dismissed, not skipped', () => {
  const { getByText, decisions } = renderBanner([opencodeQuestion], 'OpenCode');

  fireEvent.click(getByText('Dismiss'));

  assert.deepEqual(decisions, [{ ids: 'que_1', decision: { allow: false } }]);
});

test('a question that offers its options only has no typed answer', () => {
  const { getByText, queryByText } = renderBanner([{
    ...opencodeQuestion,
    input: {
      questions: [{
        question: 'Proceed?',
        header: 'Go',
        options: [{ label: 'Yes', description: '' }, { label: 'No', description: '' }],
        custom: false,
      }],
    },
  }], 'OpenCode');

  assert.ok(getByText('Yes'));
  assert.equal(queryByText('Other...') === null, true);
});

test('a Claude question keeps Skip and its answers keyed by question text', () => {
  const { getByText, decisions } = renderBanner([{
    requestId: 'claude_q',
    toolName: 'AskUserQuestion',
    input: {
      questions: [{
        question: 'Which color?',
        header: 'Color',
        options: [{ label: 'Red', description: '' }, { label: 'Blue', description: '' }],
      }],
    },
  }], 'Claude');

  assert.ok(getByText('Claude needs your input'));
  fireEvent.click(getByText('Blue'));
  fireEvent.click(getByText('Submit'));
  fireEvent.click(getByText('Skip'));

  assert.deepEqual(decisions[0].decision, {
    allow: true,
    updatedInput: {
      questions: [{
        question: 'Which color?',
        header: 'Color',
        options: [{ label: 'Red', description: '' }, { label: 'Blue', description: '' }],
      }],
      answers: { 'Which color?': 'Blue' },
    },
  });
  assert.equal(decisions[1].decision.allow, true);
});
