import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  closeConnection,
  getConnection,
  initializeDatabase,
  sessionDraftsDb,
  userPreferencesDb,
} from '@/modules/database/index.js';

const USER_ID = 1;

async function withDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'user-prefs-db-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await writeFile(databasePath, '');
  await initializeDatabase();

  // Both tables cascade from users(id), so a row has to exist to write against.
  getConnection()
    .prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)')
    .run(USER_ID, 'tester', 'hash');

  try {
    await runTest();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

test('preferences round-trip every JSON shape a setting can take', async () => {
  await withDatabase(() => {
    userPreferencesDb.savePreferences(USER_ID, {
      theme: 'dark',
      tasksEnabled: false,
      claudePermissions: { allowedTools: ['Read'], skipPermissions: true },
    });

    assert.deepEqual(userPreferencesDb.getPreferences(USER_ID), {
      theme: 'dark',
      tasksEnabled: false,
      claudePermissions: { allowedTools: ['Read'], skipPermissions: true },
    });
  });
});

test('saving preferences merge-patches instead of replacing the whole set', async () => {
  await withDatabase(() => {
    userPreferencesDb.savePreferences(USER_ID, { theme: 'dark', userLanguage: 'de' });
    userPreferencesDb.savePreferences(USER_ID, { theme: 'light' });

    assert.deepEqual(userPreferencesDb.getPreferences(USER_ID), {
      theme: 'light',
      userLanguage: 'de',
    });
  });
});

test('a preference set to undefined is removed', async () => {
  await withDatabase(() => {
    userPreferencesDb.savePreferences(USER_ID, { theme: 'dark', userLanguage: 'de' });
    userPreferencesDb.savePreferences(USER_ID, { userLanguage: undefined });

    assert.deepEqual(userPreferencesDb.getPreferences(USER_ID), { theme: 'dark' });
  });
});

test('one unreadable preference value does not cost the user the others', async () => {
  await withDatabase(() => {
    userPreferencesDb.savePreferences(USER_ID, { theme: 'dark' });
    getConnection()
      .prepare(
        `INSERT INTO user_preferences (user_id, preference_key, preference_value)
         VALUES (?, ?, ?)`
      )
      .run(USER_ID, 'broken', 'not json');

    assert.deepEqual(userPreferencesDb.getPreferences(USER_ID), { theme: 'dark' });
  });
});

test('drafts round-trip text and queued message per scope', async () => {
  await withDatabase(() => {
    sessionDraftsDb.saveDraft(USER_ID, 'session-a', { text: 'half typed', queuedMessage: null });
    sessionDraftsDb.saveDraft(USER_ID, 'project:p1', {
      text: '',
      queuedMessage: { content: 'run it' },
    });

    const drafts = sessionDraftsDb.getDrafts(USER_ID);
    const byScope = new Map(drafts.map((draft) => [draft.scope, draft]));

    assert.equal(byScope.get('session-a')?.text, 'half typed');
    assert.equal(byScope.get('session-a')?.queuedMessage, null);
    assert.equal(byScope.get('project:p1')?.text, '');
    assert.deepEqual(byScope.get('project:p1')?.queuedMessage, { content: 'run it' });
  });
});

test('saving an empty draft deletes the row rather than keeping a blank one', async () => {
  await withDatabase(() => {
    sessionDraftsDb.saveDraft(USER_ID, 'session-a', { text: 'typed', queuedMessage: null });
    sessionDraftsDb.saveDraft(USER_ID, 'session-a', { text: '', queuedMessage: null });

    assert.deepEqual(sessionDraftsDb.getDrafts(USER_ID), []);
  });
});

test('deleteDraft removes only the named scope', async () => {
  await withDatabase(() => {
    sessionDraftsDb.saveDraft(USER_ID, 'session-a', { text: 'a', queuedMessage: null });
    sessionDraftsDb.saveDraft(USER_ID, 'session-b', { text: 'b', queuedMessage: null });

    sessionDraftsDb.deleteDraft(USER_ID, 'session-a');

    assert.deepEqual(
      sessionDraftsDb.getDrafts(USER_ID).map((draft) => draft.scope),
      ['session-b'],
    );
  });
});

const queuedIn = (scope: string) => (
  sessionDraftsDb.getDrafts(USER_ID).find((draft) => draft.scope === scope)?.queuedMessage ?? null
);

// What the dispatcher holds after listing a scope's queued message.
const claimCandidate = (scope: string) => {
  const row = getConnection()
    .prepare('SELECT queued_message FROM session_drafts WHERE user_id = ? AND draft_scope = ?')
    .get(USER_ID, scope) as { queued_message: string };
  return {
    userId: USER_ID,
    sessionId: scope,
    queuedMessage: JSON.parse(row.queued_message) as unknown,
    claimToken: row.queued_message,
  };
};

test('follow-ups queued while one waits are appended in order, not overwritten', async () => {
  await withDatabase(() => {
    sessionDraftsDb.saveDraftText(USER_ID, 'session-a', 'still typing');

    const first = sessionDraftsDb.appendQueuedMessage(USER_ID, 'session-a', {
      content: 'A', options: { model: 'sonnet' }, attachments: [{ name: 'a.png' }],
    });
    const second = sessionDraftsDb.appendQueuedMessage(USER_ID, 'session-a', {
      content: 'B', attachments: [],
    });
    const third = sessionDraftsDb.appendQueuedMessage(USER_ID, 'session-a', {
      content: 'C', options: { model: 'opus' }, attachments: [{ name: 'c.txt' }],
    });

    assert.equal(first?.appended, false);
    assert.equal(second?.appended, true);
    assert.equal(third?.appended, true);
    const expected = {
      content: 'A\n\nB\n\nC',
      options: { model: 'opus' },
      attachments: [{ name: 'a.png' }, { name: 'c.txt' }],
    };
    assert.deepEqual(third?.queuedMessage, expected);
    assert.deepEqual(queuedIn('session-a'), expected);
    assert.equal(sessionDraftsDb.getDrafts(USER_ID)[0]?.text, 'still typing', 'the draft text is untouched');
  });
});

test('a follow-up queued after the dispatcher claimed the waiting message is queued on its own', async () => {
  await withDatabase(() => {
    sessionDraftsDb.appendQueuedMessage(USER_ID, 'session-a', { content: 'A', attachments: [] });
    assert.equal(sessionDraftsDb.claimQueuedMessage(claimCandidate('session-a')), true);

    const result = sessionDraftsDb.appendQueuedMessage(USER_ID, 'session-a', { content: 'B', attachments: [] });

    assert.equal(result?.appended, false);
    assert.deepEqual(queuedIn('session-a'), { content: 'B', attachments: [] }, 'A is not sent a second time');
  });
});

test('a claim listed before a follow-up was appended no longer matches, so it is not sent short', async () => {
  await withDatabase(() => {
    sessionDraftsDb.appendQueuedMessage(USER_ID, 'session-a', { content: 'A', attachments: [] });
    const listedBeforeB = claimCandidate('session-a');
    sessionDraftsDb.appendQueuedMessage(USER_ID, 'session-a', { content: 'B', attachments: [] });

    assert.equal(sessionDraftsDb.claimQueuedMessage(listedBeforeB), false);
    assert.equal((queuedIn('session-a') as { content: string }).content, 'A\n\nB');
  });
});

test('saving draft text leaves the queued message alone and keeps the row while it waits', async () => {
  await withDatabase(() => {
    sessionDraftsDb.appendQueuedMessage(USER_ID, 'session-a', { content: 'A', attachments: [] });

    sessionDraftsDb.saveDraftText(USER_ID, 'session-a', 'typing the next one');
    assert.deepEqual(queuedIn('session-a'), { content: 'A', attachments: [] });

    sessionDraftsDb.saveDraftText(USER_ID, 'session-a', '');
    assert.deepEqual(queuedIn('session-a'), { content: 'A', attachments: [] });

    // After a claim, a text save must not bring the sent message back.
    assert.equal(sessionDraftsDb.claimQueuedMessage(claimCandidate('session-a')), true);
    sessionDraftsDb.saveDraftText(USER_ID, 'session-a', 'x');
    assert.equal(queuedIn('session-a'), null);

    // And once nothing is left, the row goes.
    sessionDraftsDb.saveDraftText(USER_ID, 'session-a', '');
    assert.deepEqual(sessionDraftsDb.getDrafts(USER_ID), []);
  });
});

test('clearing the queued message keeps the draft text, and drops an emptied row', async () => {
  await withDatabase(() => {
    sessionDraftsDb.saveDraftText(USER_ID, 'session-a', 'keep me');
    sessionDraftsDb.appendQueuedMessage(USER_ID, 'session-a', { content: 'A', attachments: [] });
    sessionDraftsDb.appendQueuedMessage(USER_ID, 'session-b', { content: 'B', attachments: [] });

    sessionDraftsDb.clearQueuedMessage(USER_ID, 'session-a');
    sessionDraftsDb.clearQueuedMessage(USER_ID, 'session-b');

    assert.deepEqual(
      sessionDraftsDb.getDrafts(USER_ID).map((draft) => [draft.scope, draft.text, draft.queuedMessage]),
      [['session-a', 'keep me', null]],
    );
  });
});

test('a slash command is never merged with another queued message, in either order', async () => {
  await withDatabase(() => {
    sessionDraftsDb.appendQueuedMessage(USER_ID, 'session-a', { content: 'fix the test', attachments: [] });
    assert.equal(
      sessionDraftsDb.appendQueuedMessage(USER_ID, 'session-a', { content: '/compact', attachments: [] }),
      null,
    );
    assert.deepEqual(queuedIn('session-a'), { content: 'fix the test', attachments: [] }, 'the waiting text is kept as it was');

    sessionDraftsDb.appendQueuedMessage(USER_ID, 'session-b', { content: '  /review src', attachments: [] });
    assert.equal(
      sessionDraftsDb.appendQueuedMessage(USER_ID, 'session-b', { content: 'then fix it', attachments: [] }),
      null,
    );
    assert.deepEqual(queuedIn('session-b'), { content: '  /review src', attachments: [] }, 'the waiting command is kept as it was');

    // On its own, with nothing waiting, a command is queued as before.
    assert.equal(sessionDraftsDb.claimQueuedMessage(claimCandidate('session-a')), true);
    const alone = sessionDraftsDb.appendQueuedMessage(USER_ID, 'session-a', { content: '/compact', attachments: [] });
    assert.deepEqual(alone, { queuedMessage: { content: '/compact', attachments: [] }, appended: false });
  });
});

test('a claim restored after losing a race goes back in front of a follow-up queued meanwhile', async () => {
  await withDatabase(() => {
    sessionDraftsDb.appendQueuedMessage(USER_ID, 'session-a', { content: 'A', attachments: [{ name: 'a.png' }] });
    const claimed = claimCandidate('session-a');
    assert.equal(sessionDraftsDb.claimQueuedMessage(claimed), true);
    sessionDraftsDb.appendQueuedMessage(USER_ID, 'session-a', { content: 'B', options: { model: 'opus' }, attachments: [] });

    sessionDraftsDb.restoreQueuedMessage(claimed);

    assert.deepEqual(queuedIn('session-a'), {
      content: 'A\n\nB',
      options: { model: 'opus' },
      attachments: [{ name: 'a.png' }],
    });
  });
});

test('an attachments-only message merged with a later text gains no leading blank line', async () => {
  await withDatabase(() => {
    sessionDraftsDb.appendQueuedMessage(USER_ID, 'session-a', { content: '', attachments: [{ name: 'a.png' }] });

    const result = sessionDraftsDb.appendQueuedMessage(USER_ID, 'session-a', { content: 'B', attachments: [] });

    assert.deepEqual(result?.queuedMessage, { content: 'B', attachments: [{ name: 'a.png' }] });
  });
});

test('a claim restored after its emptied row was removed is written back', async () => {
  await withDatabase(() => {
    sessionDraftsDb.appendQueuedMessage(USER_ID, 'session-a', { content: 'A', attachments: [] });
    const claimed = claimCandidate('session-a');
    assert.equal(sessionDraftsDb.claimQueuedMessage(claimed), true);
    sessionDraftsDb.deleteEmptyDraft(USER_ID, 'session-a');
    assert.deepEqual(sessionDraftsDb.getDrafts(USER_ID), []);

    sessionDraftsDb.restoreQueuedMessage(claimed);

    assert.deepEqual(queuedIn('session-a'), { content: 'A', attachments: [] });
  });
});
