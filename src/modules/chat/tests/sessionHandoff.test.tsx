import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

import { api } from '@/shared/api';
import { writeDraftText } from '@/shared/chatDrafts';
import { SessionHandoffButton } from '@/modules/chat/modals/SessionHandoffButton';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/shared/api', () => ({ api: { handoffSession: vi.fn() } }));
vi.mock('@/shared/chatDrafts', () => ({ writeDraftText: vi.fn() }));

const catalog = {
  claude: { DEFAULT: 'source-model', OPTIONS: [{ value: 'source-model', label: 'Source model' }] },
  codex: { DEFAULT: 'target-model', OPTIONS: [{ value: 'target-model', label: 'Target model' }] },
};

beforeEach(() => vi.clearAllMocks());

test('offers only other providers and opens their durable draft without sending it', async () => {
  const onNavigate = vi.fn();
  vi.mocked(api.handoffSession).mockResolvedValue({ ok: true, json: async () => ({ data: { sessionId: 'target', draft: 'Conversation context' } }) } as Response);
  render(<SessionHandoffButton sessionId="source" provider="claude" disabled={false} providerModelCatalog={catalog} onNavigate={onNavigate} />);
  fireEvent.click(screen.getByRole('button', { name: 'handoff.title' }));
  expect(screen.queryByRole('option', { name: 'Source model' })).toBeNull();
  expect(screen.getByRole('button', { name: 'handoff.createDraft' }).hasAttribute('disabled')).toBe(true);
  fireEvent.change(screen.getByRole('combobox'), { target: { value: JSON.stringify({ provider: 'codex', model: 'target-model' }) } });
  fireEvent.click(screen.getByRole('button', { name: 'handoff.createDraft' }));
  await waitFor(() => expect(onNavigate).toHaveBeenCalledWith('target'));
  expect(api.handoffSession).toHaveBeenCalledWith('source', { provider: 'codex', model: 'target-model' });
  expect(writeDraftText).toHaveBeenCalledWith('target', 'Conversation context');
  expect(vi.mocked(writeDraftText).mock.invocationCallOrder[0]).toBeLessThan(onNavigate.mock.invocationCallOrder[0]);
});

test('disables the action for an active source session', () => {
  render(<SessionHandoffButton sessionId="source" provider="claude" disabled providerModelCatalog={catalog} onNavigate={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'handoff.title' }).hasAttribute('disabled')).toBe(true);
});

test('shows handoff errors without navigating or replacing a draft', async () => {
  const onNavigate = vi.fn();
  vi.mocked(api.handoffSession).mockResolvedValue({ ok: false, json: async () => ({ error: { message: 'Source is busy' } }) } as Response);
  render(<SessionHandoffButton sessionId="source" provider="claude" disabled={false} providerModelCatalog={catalog} onNavigate={onNavigate} />);
  fireEvent.click(screen.getByRole('button', { name: 'handoff.title' }));
  fireEvent.change(screen.getByRole('combobox'), { target: { value: JSON.stringify({ provider: 'codex', model: 'target-model' }) } });
  fireEvent.click(screen.getByRole('button', { name: 'handoff.createDraft' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Source is busy'));
  expect(onNavigate).not.toHaveBeenCalled();
  expect(writeDraftText).not.toHaveBeenCalled();
});

test('does not pull the user back after they navigate away while creating the draft', async () => {
  const onNavigate = vi.fn();
  let resolveResponse: (response: Response) => void = () => {};
  vi.mocked(api.handoffSession).mockReturnValue(new Promise((resolve) => { resolveResponse = resolve; }));
  const view = render(<SessionHandoffButton sessionId="source" provider="claude" disabled={false} providerModelCatalog={catalog} onNavigate={onNavigate} />);
  fireEvent.click(screen.getByRole('button', { name: 'handoff.title' }));
  fireEvent.change(screen.getByRole('combobox'), { target: { value: JSON.stringify({ provider: 'codex', model: 'target-model' }) } });
  fireEvent.click(screen.getByRole('button', { name: 'handoff.createDraft' }));
  view.unmount();
  resolveResponse({ ok: true, json: async () => ({ data: { sessionId: 'target', draft: 'Context' } }) } as Response);
  await Promise.resolve();
  await Promise.resolve();
  expect(onNavigate).not.toHaveBeenCalled();
});
