import assert from 'node:assert/strict';

import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import AppErrorBoundary from '@/shared/ui/AppErrorBoundary';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

/** Child that always throws during render, to trip the boundary. */
function Bomb(): JSX.Element {
  throw new Error('render exploded');
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // React logs the caught error (and jsdom logs the uncaught-render warning)
  // to console.error; both are expected noise for this test, not a signal.
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  consoleErrorSpy.mockRestore();
});

/**
 * Without a boundary above it, a throw here takes the whole React root down
 * to nothing — the exact failure mode reported in
 * https://github.com/siteboon/claudecodeui/issues/1128 ("blank screen after
 * successful login", reproduced on iOS Safari, Windows/Chrome and Electron
 * alike, because in every case what's left on screen is host chrome, not
 * anything React rendered).
 */
test('renders a fallback instead of unmounting the tree when a child throws', () => {
  render(
    <AppErrorBoundary>
      <Bomb />
    </AppErrorBoundary>
  );

  assert.ok(screen.getByText('misc.appErrorTitle'));
  assert.ok(screen.getByText('misc.appErrorDescription'));
});

test('renders children normally when nothing throws', () => {
  render(
    <AppErrorBoundary>
      <div>workspace content</div>
    </AppErrorBoundary>
  );

  assert.ok(screen.getByText('workspace content'));
  assert.equal(screen.queryByText('misc.appErrorTitle'), null);
});

test('the reload action asks the page to reload', () => {
  const reload = vi.fn();
  // jsdom's window.location.reload throws "Not implemented", so stub it for
  // this test. afterEach unstubs, so a failed assertion can't leak the stub.
  vi.stubGlobal('location', { ...window.location, reload });

  render(
    <AppErrorBoundary>
      <Bomb />
    </AppErrorBoundary>
  );

  fireEvent.click(screen.getByText('misc.reloadApp'));
  assert.equal(reload.mock.calls.length, 1);
});
