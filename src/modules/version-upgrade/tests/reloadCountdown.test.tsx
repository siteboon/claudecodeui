import assert from 'node:assert/strict';

import { act, fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { afterEach, beforeEach, test, vi } from 'vitest';

import enCommon from '@/modules/i18n/locales/en/common.json';

/**
 * On the platform, "Update Now" restarts the environment and the modal then
 * hard-reloads the window on its own after a two-minute countdown. The notice
 * that announced this was one line of prose whose seconds counter read as a
 * static sentence, and it never said the reload would happen by itself. The
 * panel now shows a clock that visibly ticks, says plainly that the window
 * reloads itself, and offers to do it right away.
 *
 * These tests drive the real modal with the clock faked so each tick is
 * observable, and assert against the shipped English strings because the
 * wording is what was wrong.
 */

const { updateMock } = vi.hoisted(() => ({ updateMock: vi.fn() }));

vi.mock('@/shared/api', () => ({
  api: { system: { update: updateMock } },
}));

// IS_PLATFORM is resolved once, when `@/shared/utils` first evaluates, so the
// flag has to be in place before the modal that imports it is loaded.
vi.stubEnv('VITE_IS_PLATFORM', 'true');
const { VersionUpgradeModal } = await import('@/modules/version-upgrade/VersionUpgradeModal');

await i18next.use(initReactI18next).init({
  resources: { en: { common: enCommon } },
  lng: 'en',
  defaultNS: 'common',
  interpolation: { escapeValue: false },
});

const renderModal = (isOpen = true) => render(
  <VersionUpgradeModal
    isOpen={isOpen}
    onClose={() => undefined}
    releaseInfo={null}
    currentVersion="1.0.0"
    latestVersion="1.1.0"
    installMode="git"
  />,
);

const clickUpdateNow = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Update Now' }));
  });
};

// Each tick re-arms its own timeout from an effect, so the clock is advanced
// one second at a time to let React commit in between.
const tick = (seconds: number) => {
  for (let i = 0; i < seconds; i += 1) {
    act(() => {
      vi.advanceTimersByTime(1000);
    });
  }
};

const replacedUrl = () => (window.location.replace as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  updateMock.mockResolvedValue(new Response(JSON.stringify({ output: 'updated' }), { status: 200 }));
  // jsdom's Location methods are non-configurable, so the whole object is swapped
  // for one the modal can read `href` from and whose `replace` records the call.
  vi.stubGlobal('location', { href: 'http://localhost/', replace: vi.fn() });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('the countdown starts at 2:00 and ticks down every second', async () => {
  renderModal();
  await clickUpdateNow();

  assert.ok(screen.getByText('Updating the environment…'));
  assert.ok(screen.getByText(/Reloading in/));
  assert.ok(screen.getByText('2:00'));
  const bar = () => document.querySelector<HTMLElement>('[style*="width"]');
  assert.equal(bar()?.style.width, '100%');
  tick(1);
  assert.ok(screen.getByText('1:59'));
  // The bar drains with the clock: 119/120 of the way full after one tick.
  assert.equal(bar()?.style.width, `${(119 / 120) * 100}%`);
  tick(1);
  assert.ok(screen.getByText('1:58'));
});

test('the notice says the window will reload itself', async () => {
  renderModal();
  await clickUpdateNow();

  assert.ok(screen.getByText(/reload itself automatically/));
  assert.ok(screen.getByText(/restart the environment/));
});

test('"Reload now" hard-reloads the window immediately', async () => {
  renderModal();
  await clickUpdateNow();

  fireEvent.click(screen.getByRole('button', { name: 'Reload now' }));

  assert.match(replacedUrl() ?? '', /_hardReload=/);
});

test('the window hard-reloads by itself when the countdown reaches zero', async () => {
  renderModal();
  await clickUpdateNow();

  tick(119);
  assert.equal(replacedUrl(), undefined);
  tick(1);
  assert.match(replacedUrl() ?? '', /_hardReload=/);
  // The frame the page can sit on while the reload is in flight says so,
  // rather than showing a stuck "0:00" next to a button that does the same thing.
  assert.ok(screen.getByText('Reloading now…'));
  assert.equal(screen.queryByText(/Reloading in/), null);
  assert.equal(screen.queryByRole('button', { name: 'Reload now' }), null);
});

test('closing the modal early does not cancel the reload', async () => {
  const view = renderModal();
  await clickUpdateNow();

  view.rerender(
    <VersionUpgradeModal
      isOpen={false}
      onClose={() => undefined}
      releaseInfo={null}
      currentVersion="1.0.0"
      latestVersion="1.1.0"
      installMode="git"
    />,
  );
  assert.equal(screen.queryByText(/Reloading in/), null);

  tick(120);
  assert.match(replacedUrl() ?? '', /_hardReload=/);
});
