import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

/**
 * A file outside the chat's project (e.g. a chart under ~/artifacts) is shown
 * only after the user confirms; the confirmed retry asks the server with
 * `allowOutside` and the image renders.
 */
const calls: Array<{ path: string; allowOutside: boolean }> = [];

vi.mock('@/shared/api', () => ({
  api: {
    readFileBlob: async (_projectId: string, filePath: string, _options: unknown, allowOutside = false) => {
      calls.push({ path: filePath, allowOutside });
      if (!allowOutside) {
        return new Response(
          JSON.stringify({ error: 'This file is outside the project. Confirm to open it read-only.', code: 'OUTSIDE_PROJECT_CONFIRM' }),
          { status: 403, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }), { status: 200 });
    },
  },
}));

const { default: CodeEditorMediaPreview } = await import('@/modules/code-editor/CodeEditorMediaPreview');

const labels = {
  loading: 'Loading preview...',
  error: 'Unable to display this file.',
  openInNewTab: 'Open in new tab',
  fullscreen: 'Fullscreen',
  exitFullscreen: 'Exit fullscreen',
  close: 'Close',
  outsideTitle: 'This file is outside the project',
  outsideMessage: 'It can be opened read-only.',
  outsideConfirm: 'Open read-only',
};

test('an image outside the project asks first, then renders after confirming', async () => {
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:preview');
  globalThis.URL.revokeObjectURL = vi.fn();
  const file = { name: 'ewr01-wait-times.png', path: '/home/u/artifacts/ewr01-wait-times.png', projectId: 'p1' };

  render(
    <CodeEditorMediaPreview
      file={file as never}
      kind="image"
      projectId="p1"
      isSidebar
      isFullscreen={false}
      onClose={() => undefined}
      onToggleFullscreen={() => undefined}
      labels={labels}
    />,
  );

  const confirm = await screen.findByRole('button', { name: 'Open read-only' });
  expect(screen.queryByText('Unable to display this file.')).toBeNull();
  expect(calls.at(-1)).toEqual({ path: file.path, allowOutside: false });

  fireEvent.click(confirm);
  await waitFor(() => expect(screen.getByRole('img', { name: file.name })).toBeTruthy());
  expect(calls.at(-1)).toEqual({ path: file.path, allowOutside: true });
});
