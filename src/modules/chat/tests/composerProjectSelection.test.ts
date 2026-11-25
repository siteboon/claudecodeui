import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import type { Project, ProjectSession } from '@/shared/types';
import { resetUserPreferences } from '@/shared/userSettings';

/**
 * A new chat starts from the selection of its project's latest session, an
 * open session restores what the backend recorded for it, and anything the
 * user picks wins over both, also against a load that overlaps the save.
 *
 * The api mock is a tiny backend: one session row that saves write and loads
 * read, with hooks to hold a save or a read until the test lets it finish.
 */

const { backend } = vi.hoisted(() => {
  const okJson = (data: unknown) => ({ ok: true, json: async () => data });
  type Row = { model: string | null; effort: string | null; permissionMode: string | null };
  const backend = {
    okJson,
    row: { model: 'sonnet', effort: null, permissionMode: 'plan' } as Row,
    project: { model: 'opus', effort: null, permissionMode: 'acceptEdits' } as Row | null,
    /** Awaited before a save writes the row, or before a read answers. */
    beforeSave: null as Promise<void> | null,
    beforeRead: null as Promise<void> | null,
    failEffort: false,
    reads: 0,
    savedModes: [] as Array<[string, string, string]>,
    async save(field: keyof Row, value: string) {
      if (backend.beforeSave) {
        await backend.beforeSave;
      }
      backend.row[field] = value;
      return okJson({ success: true, data: null });
    },
  };
  return { backend };
});

vi.mock('@/shared/api', () => ({
  api: {
    user: {
      preferences: async () => backend.okJson({ success: true, preferences: {} }),
      savePreferences: async () => backend.okJson({ success: true, preferences: {} }),
    },
    providers: {
      models: async (provider: string) => backend.okJson({
        success: true,
        data: provider === 'claude'
          ? {
            models: {
              // Effort levels, so effort assertions see real values, not the default.
              OPTIONS: ['sonnet', 'opus'].map((value) => ({
                value,
                label: value,
                // Only opus offers max, so a pick can be valid for one model alone.
                effort: { values: [{ value: 'low' }, { value: 'high' }, ...(value === 'opus' ? [{ value: 'max' }] : [])] },
              })),
              DEFAULT: 'sonnet',
            },
          }
          : null,
      }),
      capabilities: async () => backend.okJson({ success: true, data: null }),
      sessionActiveModel: async () => {
        // Snapshot first: the row as it was when the read reached the server.
        const snapshot = { ...backend.row };
        backend.reads += 1;
        if (backend.beforeRead) {
          await backend.beforeRead;
        }
        return backend.okJson({ success: true, data: { ...snapshot, source: 'session' } });
      },
      setSessionActiveModel: (_provider: string, _sessionId: string, model: string) => backend.save('model', model),
      setSessionActiveEffort: async (_provider: string, _sessionId: string, effort: string) => (
        backend.failEffort ? { ok: false, json: async () => ({ success: false }) } : backend.save('effort', effort)
      ),
      setSessionActivePermissionMode: (provider: string, sessionId: string, mode: string) => {
        backend.savedModes.push([provider, sessionId, mode]);
        return backend.save('permissionMode', mode);
      },
      projectSelection: async () => backend.okJson({ success: true, data: backend.project }),
    },
  },
}));

const project = { projectId: 'project-1', displayName: 'repo', fullPath: '/repo' } as Project;

/** A gate the test opens itself, after doing something in between. */
const gate = () => {
  let open: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
};

type HookProps = {
  selectedSession: ProjectSession | null;
  selectedProject: Project;
  newSessionTrigger: number;
  currentSessionId: string | null;
};

/**
 * Renders the hook the way ChatInterface feeds it. `rerender` changes only the
 * props it is given, and `establish` does what ChatInterface does when a new
 * chat's session is created: seed it and give the chat its id.
 */
const renderProviderState = async (initialSession: ProjectSession | null) => {
  const { useChatProviderState } = await import('@/modules/chat/hooks/useChatProviderState');
  let props: HookProps = {
    selectedSession: initialSession,
    selectedProject: project,
    newSessionTrigger: 0,
    currentSessionId: initialSession?.id ?? null,
  };
  const hook = renderHook(
    (current: HookProps) => useChatProviderState(current),
    { initialProps: props },
  );
  const rerender = (next: Partial<HookProps>) => {
    props = { ...props, ...next };
    hook.rerender(props);
  };
  const establish = (
    provider: 'claude' | 'codex',
    sessionId: string,
    selection: { model?: string; effort?: string; permissionMode?: string } = {},
  ) => {
    act(() => {
      hook.result.current.seedSessionSelection({
        provider,
        sessionId,
        selection,
        projectPath: props.selectedProject.fullPath,
        newSessionTrigger: props.newSessionTrigger,
      });
    });
    rerender({ currentSessionId: sessionId });
  };
  return { result: hook.result, rerender, establish };
};

const session = (id: string) => ({ id, __provider: 'claude' }) as ProjectSession;

beforeEach(() => {
  localStorage.clear();
  resetUserPreferences();
  backend.row = { model: 'sonnet', effort: null, permissionMode: 'plan' };
  backend.project = { model: 'opus', effort: null, permissionMode: 'acceptEdits' };
  backend.beforeSave = null;
  backend.beforeRead = null;
  backend.failEffort = false;
  backend.reads = 0;
  backend.savedModes = [];
});

afterEach(() => {
  vi.resetModules();
});

test('a new chat starts from the project selection until the user picks', async () => {
  localStorage.setItem('claude-model', 'sonnet');
  localStorage.setItem('permissionMode-last-claude', 'default');
  const { result } = await renderProviderState(null);

  await waitFor(() => {
    assert.equal(result.current.currentProviderModel, 'opus');
    assert.equal(result.current.permissionMode, 'acceptEdits');
  });
  // An overlay, not a new per-provider default that other projects would inherit.
  assert.equal(localStorage.getItem('claude-model'), 'sonnet');
  assert.equal(localStorage.getItem('permissionMode-last-claude'), 'default');

  act(() => {
    result.current.selectPermissionMode('plan');
  });
  await act(async () => {
    await result.current.selectProviderModel('claude', 'sonnet');
  });

  assert.equal(result.current.permissionMode, 'plan');
  assert.equal(result.current.currentProviderModel, 'sonnet');
  assert.equal(backend.savedModes.length, 0);
});

test('a pick made before the project selection arrives keeps that field only', async () => {
  localStorage.setItem('claude-model', 'sonnet');
  const { useChatProviderState } = await import('@/modules/chat/hooks/useChatProviderState');
  const { result } = renderHook(() => useChatProviderState({ selectedSession: null, selectedProject: project }));

  // Synchronously after mount, before the project request has answered.
  act(() => {
    result.current.selectPermissionMode('plan');
  });

  await waitFor(() => {
    assert.equal(result.current.currentProviderModel, 'opus');
  });
  assert.equal(result.current.permissionMode, 'plan');
});

test('the empty state shows the project model and its own pick replaces it', async () => {
  localStorage.setItem('claude-model', 'sonnet');
  const { result } = await renderProviderState(null);

  await waitFor(() => {
    assert.equal(result.current.providerModels.claude, 'opus');
  });

  // Custom-model housekeeping writes the stored default; that is not a pick.
  act(() => {
    result.current.setStoredProviderModel('claude', 'sonnet');
  });
  assert.equal(result.current.currentProviderModel, 'opus');

  // The empty-state picker goes through the same pick as the composer.
  await act(async () => {
    await result.current.selectProviderModel('claude', 'sonnet');
  });

  assert.equal(result.current.currentProviderModel, 'sonnet');
  assert.equal(result.current.providerModels.claude, 'sonnet');
});

test('an effort pick in a new chat is checked against the project model it shows', async () => {
  localStorage.setItem('claude-model', 'sonnet');
  const { result } = await renderProviderState(null);
  await waitFor(() => {
    assert.equal(result.current.currentProviderModel, 'opus');
  });

  await act(async () => {
    await result.current.selectProviderEffort('claude', 'max');
  });

  // Sonnet, the provider default, has no max; the opus the chat shows does.
  assert.equal(result.current.currentProviderEffort, 'max');
});

test('an open session restores and saves its backend permission mode', async () => {
  localStorage.setItem('permissionMode-last-claude', 'default');
  const { result } = await renderProviderState(session('session-1'));

  await waitFor(() => {
    assert.equal(result.current.permissionMode, 'plan');
  });

  act(() => {
    result.current.selectPermissionMode('acceptEdits');
  });

  assert.equal(result.current.permissionMode, 'acceptEdits');
  assert.deepEqual(backend.savedModes[0], ['claude', 'session-1', 'acceptEdits']);
  // Kept as a synchronous cache for the next open, before the backend answers.
  assert.equal(localStorage.getItem('permissionMode-session-1'), 'acceptEdits');
});

test('a mode picked while the session loads survives that load', async () => {
  const read = gate();
  backend.beforeRead = read.promise;
  const { result } = await renderProviderState(session('session-1'));
  await waitFor(() => {
    assert.equal(backend.reads, 1);
  });

  // The read already took its snapshot of the row ('plan').
  act(() => {
    result.current.selectPermissionMode('acceptEdits');
  });
  backend.beforeRead = null;
  await act(async () => {
    read.open();
  });

  await waitFor(() => {
    assert.equal(backend.reads, 2);
  });
  assert.equal(result.current.permissionMode, 'acceptEdits');
});

test('a new chat keeps its selection while its new session loads', async () => {
  localStorage.setItem('claude-model', 'sonnet');
  localStorage.setItem('permissionMode-last-claude', 'default');
  backend.beforeRead = gate().promise;
  const { result, rerender, establish } = await renderProviderState(null);

  await waitFor(() => {
    assert.equal(result.current.currentProviderModel, 'opus');
    assert.equal(result.current.permissionMode, 'acceptEdits');
  });

  // The chat gets its id before navigation selects its session.
  establish('claude', 'session-new', { model: 'opus', effort: 'high', permissionMode: 'acceptEdits' });
  rerender({ selectedSession: session('session-new') });

  // The row has not answered yet; nothing may fall back to sonnet/default.
  assert.equal(result.current.currentProviderModel, 'opus');
  assert.equal(result.current.permissionMode, 'acceptEdits');
});

test('picks made before the new session is selected are read back by its first load', async () => {
  backend.row = { model: 'opus', effort: null, permissionMode: 'acceptEdits' };
  const save = gate();
  backend.beforeSave = save.promise;
  const { result, rerender, establish } = await renderProviderState(null);

  establish('claude', 'session-new', { model: 'opus', permissionMode: 'acceptEdits' });
  let modelPick: Promise<unknown> = Promise.resolve();
  act(() => {
    // No id: the pick goes to the session the new chat just created.
    modelPick = result.current.selectProviderModel('claude', 'sonnet');
    result.current.selectPermissionMode('plan');
  });
  assert.deepEqual(backend.savedModes[0], ['claude', 'session-new', 'plan']);

  rerender({ selectedSession: session('session-new') });
  // The load must not read the row while the saves are still on their way.
  await act(async () => {
    await Promise.resolve();
  });
  assert.equal(backend.reads, 0);

  await act(async () => {
    save.open();
    await modelPick;
  });

  await waitFor(() => {
    assert.equal(backend.reads, 1);
  });
  assert.equal(result.current.currentProviderModel, 'sonnet');
  assert.equal(result.current.permissionMode, 'plan');
});

test('a New Session click forgets the session the previous new chat created', async () => {
  const { result, rerender, establish } = await renderProviderState(null);

  establish('claude', 'session-new', { model: 'opus' });
  // As in ChatInterface: the trigger first; the chat's id is cleared a render later.
  rerender({ newSessionTrigger: 1 });
  act(() => {
    result.current.selectPermissionMode('plan');
  });
  rerender({ currentSessionId: null });
  act(() => {
    result.current.selectPermissionMode('acceptEdits');
  });

  assert.equal(backend.savedModes.length, 0);
});

test('a refused mode save takes the mode back', async () => {
  // An older session: no recorded mode, so the per-provider key answers.
  backend.row.permissionMode = null;
  localStorage.setItem('permissionMode-last-claude', 'plan');
  const { result } = await renderProviderState(session('session-1'));
  await waitFor(() => {
    assert.equal(backend.reads, 1);
    assert.equal(result.current.permissionMode, 'plan');
  });

  const { api } = await import('@/shared/api');
  const refuse = vi.spyOn(api.providers, 'setSessionActivePermissionMode')
    .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ success: false }) } as Response);
  await act(async () => {
    result.current.selectPermissionMode('acceptEdits');
    await refuse.mock.results[0]?.value;
  });

  await waitFor(() => {
    assert.equal(result.current.permissionMode, 'plan');
  });
  assert.equal(localStorage.getItem('permissionMode-session-1'), null);
  assert.equal(localStorage.getItem('permissionMode-last-claude'), 'plan');
});

test('an older failed mode save does not roll back a newer pick of the same mode', async () => {
  const { result } = await renderProviderState(session('session-1'));
  await waitFor(() => {
    assert.equal(result.current.permissionMode, 'plan');
  });

  const { api } = await import('@/shared/api');
  let failFirst: (() => void) | undefined;
  vi.spyOn(api.providers, 'setSessionActivePermissionMode')
    .mockImplementationOnce(() => new Promise<Response>((resolve) => {
      failFirst = () => resolve({ ok: false, status: 500, json: async () => ({ success: false }) } as Response);
    }))
    .mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true }) } as Response);
  act(() => {
    result.current.selectPermissionMode('acceptEdits');
    result.current.selectPermissionMode('default');
    result.current.selectPermissionMode('acceptEdits');
  });
  await act(async () => {
    failFirst?.();
  });

  // The last pick was saved; the first pick's rollback must not restore plan.
  assert.equal(result.current.permissionMode, 'acceptEdits');
  assert.equal(localStorage.getItem('permissionMode-session-1'), 'acceptEdits');
});

test('a failed effort save rolls back only the effort', async () => {
  backend.failEffort = true;
  backend.row = { model: 'sonnet', effort: 'low', permissionMode: 'plan' };
  const { result } = await renderProviderState(session('session-1'));
  await waitFor(() => {
    assert.equal(result.current.permissionMode, 'plan');
    assert.equal(result.current.currentProviderEffort, 'low');
  });

  await act(async () => {
    const pending = result.current.selectProviderEffort('claude', 'high');
    // Picked while the effort save is in flight.
    result.current.selectPermissionMode('acceptEdits');
    await pending.catch(() => {});
  });

  assert.equal(result.current.permissionMode, 'acceptEdits');
  assert.equal(result.current.currentProviderEffort, 'low');
});

test('a failed load keeps a seed only when it belongs to the session\'s provider', async () => {
  const { api } = await import('@/shared/api');
  const loadFailed = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(api.providers, 'sessionActiveModel').mockRejectedValue(new Error('offline'));
  localStorage.setItem('claude-model', 'sonnet');
  const { result, rerender, establish } = await renderProviderState(null);
  await waitFor(() => {
    assert.equal(result.current.currentProviderModel, 'opus');
  });

  establish('claude', 'session-new', { model: 'opus', permissionMode: 'acceptEdits' });
  rerender({ selectedSession: session('session-new') });
  await waitFor(() => {
    assert.ok(loadFailed.mock.calls.some(([message]) => String(message).includes('Error loading the session')));
  });
  assert.equal(result.current.currentProviderModel, 'opus');
  assert.equal(result.current.permissionMode, 'acceptEdits');

  // A seed under another provider is not this session's and is replaced.
  loadFailed.mockClear();
  rerender({ selectedSession: null });
  establish('codex', 'session-other', { model: 'opus' });
  rerender({ selectedSession: session('session-other') });
  await waitFor(() => {
    assert.ok(loadFailed.mock.calls.some(([message]) => String(message).includes('Error loading the session')));
  });
  assert.equal(result.current.currentProviderModel, 'sonnet');
  loadFailed.mockRestore();
});

test('after a provider switch, mode picks are not saved on the created session', async () => {
  const { result, establish } = await renderProviderState(null);

  establish('claude', 'session-new', { model: 'opus' });
  act(() => {
    result.current.setProvider('codex');
  });
  act(() => {
    result.current.selectPermissionMode('acceptEdits');
  });

  assert.equal(backend.savedModes.length, 0);
});

test('after a provider switch, model and effort picks are not saved on the created session', async () => {
  const { api } = await import('@/shared/api');
  const saveModel = vi.spyOn(api.providers, 'setSessionActiveModel');
  const saveEffort = vi.spyOn(api.providers, 'setSessionActiveEffort');
  const { result, establish } = await renderProviderState(null);

  act(() => {
    result.current.setProvider('codex');
  });
  // The session gateway answers after the switch, seeding the old provider.
  establish('claude', 'session-new', { model: 'opus' });
  await act(async () => {
    await result.current.selectProviderModel('codex', 'gpt-5.4');
    await result.current.selectProviderEffort('codex', 'high');
    result.current.selectPermissionMode('acceptEdits');
  });

  assert.equal(saveModel.mock.calls.length, 0);
  assert.equal(saveEffort.mock.calls.length, 0);
  assert.equal(backend.savedModes.length, 0);
});

test('a model from another provider is not saved on the composer session', async () => {
  const { api } = await import('@/shared/api');
  const saveModel = vi.spyOn(api.providers, 'setSessionActiveModel');
  const { result } = await renderProviderState(session('session-1'));
  await waitFor(() => {
    assert.equal(backend.reads, 1);
  });

  let scope: string | undefined;
  await act(async () => {
    ({ scope } = await result.current.selectProviderModel('codex', 'gpt-5.4'));
  });

  assert.equal(scope, 'default');
  assert.equal(saveModel.mock.calls.length, 0);
});

test('savesPickOnSession answers from the same target the save uses', async () => {
  const { result, rerender, establish } = await renderProviderState(null);
  assert.equal(result.current.savesPickOnSession('claude'), false);

  const before = result.current.savesPickOnSession;
  establish('claude', 'session-new', { model: 'opus' });
  // A new function, so a memoized modal re-renders with the new answer.
  assert.notEqual(result.current.savesPickOnSession, before);
  assert.equal(result.current.savesPickOnSession('claude'), true);
  // A pick for another provider's model only becomes that provider's default.
  assert.equal(result.current.savesPickOnSession('codex'), false);

  // As in ChatInterface: the trigger first; the chat's id is cleared a render later.
  rerender({ newSessionTrigger: 1 });
  // Already in the render between, before the chat's id is gone.
  assert.equal(result.current.savesPickOnSession('claude'), false);
  rerender({ currentSessionId: null });
  assert.equal(result.current.savesPickOnSession('claude'), false);
});

test('a project switch during the first reply turns picks into defaults', async () => {
  const { result, rerender, establish } = await renderProviderState(null);
  establish('claude', 'session-new', { model: 'opus' });

  // useChatSessionState keeps the chat's id while that reply runs, but the
  // composer now shows the other project's new chat, so picks are its defaults.
  rerender({ selectedProject: { ...project, fullPath: '/other' } });
  await waitFor(() => {
    assert.equal(result.current.currentProviderModel, 'opus');
  });
  act(() => {
    result.current.selectPermissionMode('acceptEdits');
  });

  assert.equal(result.current.savesPickOnSession('claude'), false);
  assert.equal(backend.savedModes.length, 0);
  // Not lost: it is the provider's default for the new chat.
  assert.equal(localStorage.getItem('permissionMode-last-claude'), 'acceptEdits');
});

test('a session that answers after a project switch or New Session stays with its send', async () => {
  const { result, rerender } = await renderProviderState(null);
  const seed = (projectPath: string, newSessionTrigger: number) => act(() => {
    result.current.seedSessionSelection({
      provider: 'claude',
      sessionId: 'session-new',
      selection: { model: 'opus' },
      projectPath,
      newSessionTrigger,
    });
  });
  const pickMode = (mode: 'plan' | 'acceptEdits') => act(() => {
    result.current.selectPermissionMode(mode);
  });

  // Control: the send's own project and trigger, so the session is the target.
  seed('/repo', 0);
  rerender({ currentSessionId: 'session-new' });
  pickMode('plan');
  assert.deepEqual(backend.savedModes, [['claude', 'session-new', 'plan']]);

  // The send was made in /repo, but the user is in /other when it answers.
  rerender({ selectedProject: { ...project, fullPath: '/other' } });
  seed('/repo', 0);
  assert.equal(result.current.savesPickOnSession('claude'), false);
  pickMode('acceptEdits');
  assert.equal(backend.savedModes.length, 1);

  // The send was made before a New Session click.
  rerender({ selectedProject: project, newSessionTrigger: 1 });
  seed('/repo', 0);
  assert.equal(result.current.savesPickOnSession('claude'), false);
  pickMode('acceptEdits');
  assert.equal(backend.savedModes.length, 1);
});

test('a send that answers late does not replace the current chat\'s created session', async () => {
  const { result, rerender } = await renderProviderState(null);
  rerender({ newSessionTrigger: 1 });

  // The current chat's send answers first, then the previous chat's.
  act(() => {
    result.current.seedSessionSelection({
      provider: 'claude', sessionId: 'session-b', selection: { model: 'opus' }, projectPath: '/repo', newSessionTrigger: 1,
    });
  });
  act(() => {
    result.current.seedSessionSelection({
      provider: 'claude', sessionId: 'session-a', selection: { model: 'sonnet' }, projectPath: '/repo', newSessionTrigger: 0,
    });
  });
  rerender({ currentSessionId: 'session-b' });
  act(() => {
    result.current.selectPermissionMode('plan');
  });

  assert.deepEqual(backend.savedModes, [['claude', 'session-b', 'plan']]);
});

test('a send that answers after an existing session was opened leaves that session\'s selection alone', async () => {
  // Unlike the catalog default (sonnet) and unlike the late send's values.
  backend.row = { model: 'opus', effort: 'low', permissionMode: 'plan' };
  const { result } = await renderProviderState(session('session-1'));
  await waitFor(() => {
    assert.equal(result.current.currentProviderModel, 'opus');
    assert.equal(result.current.currentProviderEffort, 'low');
    assert.equal(result.current.permissionMode, 'plan');
  });

  act(() => {
    result.current.seedSessionSelection({
      provider: 'claude',
      sessionId: 'session-a',
      selection: { model: 'sonnet', effort: 'high', permissionMode: 'acceptEdits' },
      projectPath: '/repo',
      newSessionTrigger: 0,
    });
  });

  assert.equal(result.current.currentProviderModel, 'opus');
  assert.equal(result.current.currentProviderEffort, 'low');
  assert.equal(result.current.permissionMode, 'plan');
});
