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

  fireEvent.change(getByLabelText(/Target/), { target: { value: '1' } });
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

  fireEvent.change(getByLabelText(/Target/), { target: { value: '0' } });
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

const singleField = (requestId: string, property: Record<string, unknown>, required = true): PendingPermissionRequest => ({
  requestId,
  toolName: 'McpElicitation',
  input: {
    serverName: 'vault',
    message: 'One question',
    mode: 'form',
    requestedSchema: { type: 'object', properties: { answer: { title: 'Answer', ...property } }, required: required ? ['answer'] : [] },
  },
});

test('an empty or blank enum value is a real choice, not the placeholder', () => {
  const { getByText, getByLabelText, decisions } = renderBanner(
    singleField('eli_4', { type: 'string', enum: ['', '  ', 'x'], enumNames: ['None', 'Blank', 'X'] }),
  );

  fireEvent.change(getByLabelText(/Answer/), { target: { value: '0' } });
  fireEvent.click(getByText('Submit'));
  fireEvent.change(getByLabelText(/Answer/), { target: { value: '1' } });
  fireEvent.click(getByText('Submit'));

  assert.deepEqual(decisions.map((entry) => entry.decision), [
    { allow: true, updatedInput: { content: { answer: '' } } },
    { allow: true, updatedInput: { content: { answer: '  ' } } },
  ]);
});

test('length limits count characters, so one emoji fits maxLength 1', () => {
  const { getByText, getByLabelText, decisions } = renderBanner(singleField('eli_5', { type: 'string', maxLength: 1 }));

  fireEvent.change(getByLabelText(/Answer/), { target: { value: '\u{1F44D}' } });
  fireEvent.click(getByText('Submit'));
  assert.deepEqual(decisions, [{ ids: 'eli_5', decision: { allow: true, updatedInput: { content: { answer: '\u{1F44D}' } } } }]);
});

test('an email or uri that the server would reject is not sent', () => {
  const email = renderBanner(singleField('eli_6', { type: 'string', format: 'email' }));
  fireEvent.change(email.getByLabelText(/Answer/), { target: { value: 'not an address' } });
  fireEvent.click(email.getByText('Submit'));
  assert.equal(email.decisions.length, 0);
  assert.ok(email.getByText('Enter an email address'));
  fireEvent.change(email.getByLabelText(/Answer/), { target: { value: 'ada@example.com' } });
  fireEvent.click(email.getByText('Submit'));
  assert.deepEqual(email.decisions[0]?.decision, { allow: true, updatedInput: { content: { answer: 'ada@example.com' } } });
  email.unmount();

  const uri = renderBanner(singleField('eli_7', { type: 'string', format: 'uri' }));
  fireEvent.change(uri.getByLabelText(/Answer/), { target: { value: 'example.com/page' } });
  fireEvent.click(uri.getByText('Submit'));
  assert.equal(uri.decisions.length, 0);
  assert.ok(uri.getByText('Enter a full address, such as https://example.com'));
});

test('a date-time answer is sent as an RFC 3339 instant with an offset', () => {
  const { getByText, getByLabelText, decisions } = renderBanner(singleField('eli_8', { type: 'string', format: 'date-time' }));

  // What a datetime-local input gives: local time, no seconds, no offset.
  fireEvent.change(getByLabelText(/Answer/), { target: { value: '2026-11-03T17:05' } });
  fireEvent.click(getByText('Submit'));
  assert.deepEqual(decisions, [{
    ids: 'eli_8',
    decision: { allow: true, updatedInput: { content: { answer: new Date('2026-11-03T17:05').toISOString() } } },
  }]);
});

test('length limits apply to a choice\'s value too', () => {
  const { getByText, getAllByText, getByLabelText, decisions } = renderBanner(
    singleField('eli_9', { type: 'string', enum: ['ab', 'abcdef'], maxLength: 4 }),
  );

  fireEvent.change(getByLabelText(/Answer/), { target: { value: '1' } });
  fireEvent.click(getByText('Submit'));
  assert.equal(decisions.length, 0);
  assert.equal(getAllByText('At most 4 characters').length, 1);

  fireEvent.change(getByLabelText(/Answer/), { target: { value: '0' } });
  fireEvent.click(getByText('Submit'));
  assert.deepEqual(decisions, [{ ids: 'eli_9', decision: { allow: true, updatedInput: { content: { answer: 'ab' } } } }]);
});

test('a date-time is measured as the UTC instant that is sent, not as typed', () => {
  // '2026-11-03T17:05' is 16 characters; the instant sent is 24.
  const { getByText, getByLabelText, decisions } = renderBanner(
    singleField('eli_10', { type: 'string', format: 'date-time', maxLength: 20 }),
  );

  fireEvent.change(getByLabelText(/Answer/), { target: { value: '2026-11-03T17:05' } });
  fireEvent.click(getByText('Submit'));
  assert.equal(decisions.length, 0);
  assert.ok(getByText('At most 20 characters'));
});

test('a local time skipped by a DST change is refused, not moved an hour', () => {
  // Node applies a TZ change at once; this file's worker is its own process.
  const previous = process.env.TZ;
  process.env.TZ = 'America/New_York';
  try {
    const { getByText, getByLabelText, decisions } = renderBanner(singleField('eli_11', { type: 'string', format: 'date-time' }));

    // 2026-03-08 02:00 jumps to 03:00 in New York, so 02:30 never happens.
    fireEvent.change(getByLabelText(/Answer/), { target: { value: '2026-03-08T02:30' } });
    fireEvent.click(getByText('Submit'));
    assert.equal(decisions.length, 0);
    assert.ok(getByText('Enter a date and time'));

    // Seconds and a fraction do not get it past the check.
    fireEvent.change(getByLabelText(/Answer/), { target: { value: '2026-03-08T02:30:00.001' } });
    fireEvent.click(getByText('Submit'));
    assert.equal(decisions.length, 0);

    fireEvent.change(getByLabelText(/Answer/), { target: { value: '2026-03-08T03:30' } });
    fireEvent.click(getByText('Submit'));
    assert.deepEqual(decisions, [{
      ids: 'eli_11',
      decision: { allow: true, updatedInput: { content: { answer: '2026-03-08T07:30:00.000Z' } } },
    }]);
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

const inputValue = (element: HTMLElement) => (element as HTMLInputElement).value;

test('a date-time default is shown in the picker and sends the same instant', () => {
  const { getByText, getByLabelText, decisions } = renderBanner(
    singleField('eli_12', { type: 'string', format: 'date-time', default: '2026-12-01T10:00:00Z' }),
  );

  // Shown, not blanked by the input while the state still holds it.
  assert.notEqual(inputValue(getByLabelText(/Answer/)), '');
  fireEvent.click(getByText('Submit'));
  assert.deepEqual(decisions, [{
    ids: 'eli_12',
    decision: { allow: true, updatedInput: { content: { answer: '2026-12-01T10:00:00.000Z' } } },
  }]);
});

test('a date-time default keeps its seconds through the picker', () => {
  const { getByText, getByLabelText, decisions } = renderBanner(
    singleField('eli_13', { type: 'string', format: 'date-time', default: '2026-12-01T10:00:30.250+00:00' }),
  );

  assert.notEqual(inputValue(getByLabelText(/Answer/)), '');
  fireEvent.click(getByText('Submit'));
  assert.deepEqual(decisions.map((entry) => entry.decision), [
    { allow: true, updatedInput: { content: { answer: '2026-12-01T10:00:30.250Z' } } },
  ]);
});

test('a default its date input cannot show starts empty and is not sent', () => {
  for (const [requestId, property] of [
    ['eli_14', { type: 'string', format: 'date', default: '2026-12-01T10:00:00Z' }],
    ['eli_15', { type: 'string', format: 'date-time', default: 'next tuesday' }],
    ['eli_16', { type: 'string', format: 'date-time', default: '2026-13-45T10:00:00Z' }],
  ] as const) {
    const required = renderBanner(singleField(requestId, property));
    assert.equal(inputValue(required.getByLabelText(/Answer/)), '');
    fireEvent.click(required.getByText('Submit'));
    assert.equal(required.decisions.length, 0);
    assert.ok(required.getByText('Required'));
    required.unmount();

    const optional = renderBanner(singleField(`${requestId}_optional`, property, false));
    fireEvent.click(optional.getByText('Submit'));
    assert.deepEqual(optional.decisions.map((entry) => entry.decision), [
      { allow: true, updatedInput: { content: {} } },
    ]);
    optional.unmount();
  }
});

test('a multi-select default that is not among the choices is neither ticked nor sent', () => {
  const { getByText, getByLabelText, decisions } = renderBanner(singleField('eli_17', {
    type: 'array',
    items: { enum: ['a', 'b'] },
    default: ['b', 'gone'],
  }));

  assert.equal((getByLabelText('b') as HTMLInputElement).checked, true);
  fireEvent.click(getByText('Submit'));
  assert.deepEqual(decisions.map((entry) => entry.decision), [
    { allow: true, updatedInput: { content: { answer: ['b'] } } },
  ]);
});

test('a long form scrolls its fields and keeps its buttons outside the scrolling part', () => {
  const { getByText, getByLabelText } = renderBanner(singleField('eli_18', { type: 'string' }));

  // jsdom has no layout, so this pins the structure the browser check measured.
  const scrollArea = getByLabelText(/Answer/).closest('.overflow-y-auto');
  assert.equal(scrollArea === null, false);
  assert.equal(scrollArea?.contains(getByText('Submit')), false);
  assert.equal(scrollArea?.contains(getByText('Decline')), false);
  assert.equal(scrollArea?.parentElement?.classList.contains('max-h-[70dvh]'), true);
});
