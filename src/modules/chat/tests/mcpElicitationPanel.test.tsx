import assert from 'node:assert/strict';

import { fireEvent, render } from '@testing-library/react';
import { test } from 'vitest';

import '@/modules/i18n';
import type { PendingPermissionRequest } from '@/shared/types';
import PermissionRequestsBanner from '@/modules/chat/composer/PermissionRequestsBanner';

/**
 * An MCP server's request for input ("elicitation") arrives as an
 * `McpElicitation` permission request. The banner draws it as a form built from
 * the requested schema and answers with typed content, or offers the link of a
 * URL request. Nothing is sent until the form fits its schema.
 */

type Decision = { ids: string | string[]; decision: Record<string, unknown> };

// Element checks compare booleans: a failing `assert.equal(element, null)` makes
// node:assert print the jsdom element, whose object graph exhausts memory.
const renderBanner = (request: PendingPermissionRequest) => {
  const decisions: Decision[] = [];
  const view = render(
    <PermissionRequestsBanner
      pendingPermissionRequests={[request]}
      providerLabel="Claude"
      handlePermissionDecision={(ids, decision) => decisions.push({ ids, decision })}
      handleGrantToolPermission={() => ({ success: true })}
    />,
  );
  return { ...view, decisions };
};

const formRequest: PendingPermissionRequest = {
  requestId: 'eli_1',
  toolName: 'McpElicitation',
  input: {
    serverName: 'vault',
    message: 'Which target should this write to?',
    mode: 'form',
    requestedSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', title: 'Target', enum: ['prod', 'dev'], enumNames: ['Production', 'Development'] },
        confirm: { type: 'boolean', title: 'Confirm' },
        count: { type: 'integer', title: 'Count', minimum: 1, maximum: 10 },
        tags: { type: 'array', title: 'Tags', items: { anyOf: [{ const: 'a', title: 'Alpha' }, { const: 'b', title: 'Beta' }] } },
        note: { type: 'string', title: 'Note' },
      },
      required: ['target', 'count'],
    },
  },
};

test('a form request is drawn as a form, not as a tool approval', () => {
  const { getByText, getByLabelText, queryByText } = renderBanner(formRequest);

  assert.ok(getByText('Which target should this write to?'));
  assert.ok(getByText('vault asks for your input'));
  assert.ok(getByLabelText(/Target/));
  assert.ok(getByLabelText(/Count/));
  assert.equal(queryByText('Permission required') === null, true);
  assert.equal(queryByText('Allow once') === null, true);
});

test('a filled form is accepted with typed content, leaving out empty optional fields', () => {
  const { getByText, getByLabelText, decisions } = renderBanner(formRequest);

  fireEvent.change(getByLabelText(/Target/), { target: { value: 'dev' } });
  fireEvent.click(getByLabelText(/Confirm/));
  fireEvent.change(getByLabelText(/Count/), { target: { value: '7' } });
  fireEvent.click(getByLabelText('Beta'));
  fireEvent.click(getByLabelText('Alpha'));
  fireEvent.click(getByText('Submit'));

  assert.deepEqual(decisions, [{
    ids: 'eli_1',
    // Picked in the server's order, whatever order they were ticked in.
    decision: { allow: true, updatedInput: { content: { target: 'dev', confirm: true, count: 7, tags: ['a', 'b'] } } },
  }]);
});

test('a form that does not fit its schema is not sent', () => {
  const { getByText, getAllByText, getByLabelText, decisions } = renderBanner(formRequest);

  fireEvent.click(getByText('Submit'));
  assert.equal(decisions.length, 0);
  assert.equal(getAllByText('Required').length, 2);

  fireEvent.change(getByLabelText(/Target/), { target: { value: 'prod' } });
  fireEvent.change(getByLabelText(/Count/), { target: { value: '2.5' } });
  fireEvent.click(getByText('Submit'));
  assert.equal(decisions.length, 0);
  assert.ok(getByText('Enter a whole number'));

  fireEvent.change(getByLabelText(/Count/), { target: { value: '11' } });
  fireEvent.click(getByText('Submit'));
  assert.equal(decisions.length, 0);
  assert.ok(getByText('At most 10'));

  fireEvent.change(getByLabelText(/Count/), { target: { value: '10' } });
  fireEvent.click(getByText('Submit'));
  assert.deepEqual(decisions, [{
    ids: 'eli_1',
    // An unticked checkbox is a visible "no", so it is sent as false.
    decision: { allow: true, updatedInput: { content: { target: 'prod', confirm: false, count: 10 } } },
  }]);
});

test('Decline answers with a denial, which the backend turns into decline', () => {
  const { getByText, decisions } = renderBanner(formRequest);

  fireEvent.click(getByText('Decline'));
  assert.deepEqual(decisions, [{ ids: 'eli_1', decision: { allow: false } }]);
});

test('a URL request offers its link, and opening it accepts', () => {
  const { getByText, decisions } = renderBanner({
    requestId: 'eli_2',
    toolName: 'McpElicitation',
    input: { serverName: 'auth', message: 'Sign in to continue.', mode: 'url', url: 'https://example.test/login' },
  });

  const link = getByText('Open link').closest('a');
  assert.equal(link?.getAttribute('href'), 'https://example.test/login');
  assert.equal(link?.getAttribute('rel'), 'noopener noreferrer');
  fireEvent.click(getByText('Open link'));
  assert.deepEqual(decisions, [{ ids: 'eli_2', decision: { allow: true, updatedInput: {} } }]);
});

test('a URL that is not http or https gets no link to open', () => {
  const { getByText, queryByText } = renderBanner({
    requestId: 'eli_3',
    toolName: 'McpElicitation',
    input: { serverName: 'auth', message: 'Open this.', mode: 'url', url: 'javascript:alert(1)' },
  });

  assert.equal(queryByText('Open link') === null, true);
  assert.ok(getByText('Only http and https links can be opened from here.'));
  assert.ok(getByText('Decline'));
});
