import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MarkdownWorkspaceContext } from '@/modules/chat/context/MarkdownWorkspaceContext';
import { ToolRenderer } from '@/modules/chat/tools/ToolRenderer';

const readFileBlob = vi.fn();
const readJob = vi.fn();
vi.mock('@/shared/api', () => ({ api: {
  readFileBlob: (...args: unknown[]) => readFileBlob(...args),
  imageGeneration: { job: (...args: unknown[]) => readJob(...args) },
} }));

const JOB_ID = 'a'.repeat(64);
const ASSET_ID = '12345678-1234-4234-8234-123456789abc';
const ASSET_PATH = 'generated-images/' + ASSET_ID + '.png';
const saved = () => ({
  kind: 'cloudcli.image_generation', version: 1, jobId: JOB_ID, status: 'succeeded',
  promptPreview: 'A blue 日本語 image',
  asset: { id: ASSET_ID, path: ASSET_PATH, mimeType: 'image/png', bytes: 69, sha256: 'b'.repeat(64) },
});
const running = () => ({ ...saved(), status: 'running', asset: undefined });
const response = (job: unknown) => ({ ok: true, json: async () => job });

beforeEach(() => {
  readJob.mockReset().mockResolvedValue({ ok: false });
  readFileBlob.mockReset().mockResolvedValue({ ok: true, blob: async () => new Blob(['synthetic PNG']) });
  URL.createObjectURL = vi.fn(() => 'blob:generated-image');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => vi.useRealTimers());

const show = (result: unknown, projectId: string | null = 'project-1') => render(
  <MarkdownWorkspaceContext.Provider value={{ projectId }}>
    <ToolRenderer toolName="mcp__image_generation__generate_image" toolInput={{}} toolResult={result} mode="result" />
  </MarkdownWorkspaceContext.Provider>,
);

describe('saved image tool cards', () => {
  it('renders a tool-returned image without requiring an assistant Markdown reply', async () => {
    const view = show({ content: [{ type: 'text', text: JSON.stringify(saved()) }] });
    expect((await view.findByRole('img')).getAttribute('src')).toBe('blob:generated-image');
    expect(readFileBlob.mock.calls[0].slice(0, 2)).toEqual(['project-1', ASSET_PATH]);
    expect(view.getByText(ASSET_ID + '.png')).toBeTruthy();
    expect(readJob.mock.calls[0].slice(0, 2)).toEqual(['project-1', JOB_ID]);
  });

  it('reloads a saved running transcript snapshot as a completed image using read-only job lookup', async () => {
    readJob.mockResolvedValue(response(saved()));
    const first = show({ content: JSON.stringify(running()) });
    await first.findByRole('img');
    first.unmount();
    const reloaded = show({ content: JSON.stringify(running()) });
    await reloaded.findByRole('img');
    expect(readJob).toHaveBeenCalledTimes(2);
    expect(readFileBlob).toHaveBeenCalledTimes(2);
  });

  it('polls accepted work, shows its saved image, and stops polling after completion', async () => {
    vi.useFakeTimers();
    readJob.mockResolvedValueOnce(response(running())).mockResolvedValue(response(saved()));
    const view = show({ structuredContent: running() });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(readJob).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(view.getByRole('img').getAttribute('src')).toBe('blob:generated-image');
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(readJob).toHaveBeenCalledTimes(2);
  });

  it('shows uncertainty without fetching image bytes or submitting another generation', async () => {
    const uncertain = { ...running(), status: 'uncertain', error: { code: 'GENERATION_UNCERTAIN', message: 'Inspect the existing job before generating again.' } };
    readJob.mockResolvedValue(response(uncertain));
    const view = show({ structuredContent: uncertain });
    expect(await view.findByRole('alert')).toHaveProperty('textContent', uncertain.error.message);
    expect(view.queryByRole('img')).toBeNull();
    expect(readFileBlob).not.toHaveBeenCalled();
  });

  it('replaces a stale successful snapshot when the saved image has been deleted', async () => {
    readJob.mockResolvedValue(response({ ...running(), status: 'missing_asset', error: { code: 'ASSET_UNAVAILABLE', message: 'Saved image is missing.' } }));
    const view = show({ structuredContent: saved() });
    await waitFor(() => expect(view.getByRole('alert').textContent).toBe('Saved image is missing.'));
    expect(view.queryByRole('img')).toBeNull();
  });

  it('does not request project files or job state outside a project context', async () => {
    const view = show({ structuredContent: saved() }, null);
    await waitFor(() => expect(view.queryByRole('img')).toBeNull());
    expect(readJob).not.toHaveBeenCalled();
    expect(readFileBlob).not.toHaveBeenCalled();
  });

  it('recovers a transient read failure using backoff without submitting a generation', async () => {
    vi.useFakeTimers();
    readJob.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(response(saved()));
    const view = show({ structuredContent: running() });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(readJob).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(view.getByRole('img').getAttribute('src')).toBe('blob:generated-image');
    expect(readJob).toHaveBeenCalledTimes(2);
  });

  it('bounds failed status reads and marks the result uncertain instead of retrying forever', async () => {
    vi.useFakeTimers();
    readJob.mockResolvedValue({ ok: false, status: 503 });
    const view = show({ structuredContent: running() });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(readJob).toHaveBeenCalledTimes(6);
    expect(view.getByRole('alert').textContent).toBeTruthy();
    expect(view.queryByRole('img')).toBeNull();
    expect(readFileBlob).not.toHaveBeenCalled();
  });

  it('does not repeat status reads when an identical provider result gets a new object identity', async () => {
    const first = { content: JSON.stringify(saved()) };
    const view = show(first);
    await view.findByRole('img');
    view.rerender(
      <MarkdownWorkspaceContext.Provider value={{ projectId: 'project-1' }}>
        <ToolRenderer toolName="mcp__image_generation__generate_image" toolInput={{}} toolResult={{ ...first }} mode="result" />
      </MarkdownWorkspaceContext.Provider>,
    );
    await act(async () => { await Promise.resolve(); });
    expect(readJob).toHaveBeenCalledTimes(1);
  });
});
