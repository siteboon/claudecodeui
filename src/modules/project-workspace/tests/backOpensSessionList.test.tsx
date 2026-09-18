import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { useBackOpensSessionList } from '@/modules/project-workspace/hooks/useBackOpensSessionList';

const userActivation = {
  hasBeenActive: false,
  isActive: false,
};

beforeEach(() => {
  vi.useFakeTimers();
  userActivation.hasBeenActive = false;
  userActivation.isActive = false;
  window.history.replaceState({}, '', '/');
  Object.defineProperty(navigator, 'userActivation', {
    configurable: true,
    value: userActivation,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const armAfterInteraction = () => {
  userActivation.hasBeenActive = true;
  userActivation.isActive = true;

  act(() => {
    window.dispatchEvent(new Event('pointerdown'));
  });
  act(() => vi.runOnlyPendingTimers());

  userActivation.isActive = false;
};

const popTo = (state: unknown, href = '/') => {
  act(() => {
    window.history.replaceState(state, '', href);
    window.dispatchEvent(new PopStateEvent('popstate', { state }));
  });
};

const renderBackHandler = (setSidebarOpen = vi.fn()) => ({
  setSidebarOpen,
  view: renderHook(
    ({ locationKey, sidebarOpen }: { locationKey: string; sidebarOpen: boolean }) =>
      useBackOpensSessionList({
        enabled: true,
        sidebarOpen,
        setSidebarOpen,
        locationKey,
      }),
    {
      initialProps: {
        locationKey: 'route-a',
        sidebarOpen: false,
      },
    },
  ),
});

test('one activated guard and one listener survive ordinary rerenders', () => {
  const addEventListener = vi.spyOn(window, 'addEventListener');
  const removeEventListener = vi.spyOn(window, 'removeEventListener');
  const pushState = vi.spyOn(window.history, 'pushState');
  const replaceState = vi.spyOn(window.history, 'replaceState');
  const { setSidebarOpen, view } = renderBackHandler();

  act(() => vi.runOnlyPendingTimers());
  assert.equal(pushState.mock.calls.length, 0, 'mounting without activation armed Back');

  armAfterInteraction();
  assert.equal(pushState.mock.calls.length, 1);
  const baseState = replaceState.mock.calls.at(-1)?.[0];

  view.rerender({ locationKey: 'route-a-rerender', sidebarOpen: false });
  act(() => vi.runOnlyPendingTimers());
  assert.equal(pushState.mock.calls.length, 1, 'a second guard accumulated');
  assert.equal(
    addEventListener.mock.calls.filter(([type]) => type === 'popstate').length,
    1,
  );

  popTo(baseState);
  assert.deepEqual(setSidebarOpen.mock.calls, [[true]]);

  view.unmount();
  assert.equal(
    removeEventListener.mock.calls.filter(([type]) => type === 'popstate').length,
    1,
  );
});

test('a remount does not claim an inherited guard as permission to open', () => {
  const pushState = vi.spyOn(window.history, 'pushState');
  const replaceState = vi.spyOn(window.history, 'replaceState');
  const first = renderBackHandler();

  armAfterInteraction();
  const baseState = replaceState.mock.calls.at(-1)?.[0];
  first.view.unmount();

  userActivation.hasBeenActive = false;
  const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
  const inherited = renderBackHandler();
  act(() => vi.runOnlyPendingTimers());

  assert.equal(pushState.mock.calls.length, 1, 'the inherited guard was stacked over');
  popTo(baseState);
  assert.equal(inherited.setSidebarOpen.mock.calls.length, 0);
  assert.equal(back.mock.calls.length, 1, 'the inherited duplicate blocked navigation');
});

test('a multi-entry jump away from an owned guard remains browser navigation', () => {
  const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
  const { setSidebarOpen } = renderBackHandler();

  armAfterInteraction();
  popTo({ idx: -1 }, '/somewhere-else');

  assert.equal(setSidebarOpen.mock.calls.length, 0);
  assert.equal(back.mock.calls.length, 0);
});
