import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSessionMessageSearch } from '@/modules/command-palette/hooks/useSessionMessageSearch';

vi.mock('@/shared/api', () => ({
  api: {
    searchConversationsUrl: (query: string) => `/api/search?q=${query}`,
  },
}));

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  readonly close = vi.fn();
  private readonly listeners = new Map<string, Set<EventListener>>();

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(eventName: string, listener: EventListener) {
    const listeners = this.listeners.get(eventName) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(eventName, listeners);
  }

  removeEventListener(eventName: string, listener: EventListener) {
    this.listeners.get(eventName)?.delete(listener);
  }

  emit(eventName: string, data: unknown) {
    const event = new MessageEvent(eventName, { data: JSON.stringify(data) });
    for (const listener of this.listeners.get(eventName) ?? []) {
      listener(event);
    }
  }
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.useFakeTimers();
  vi.stubGlobal('EventSource', FakeEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('session message search cleanup', () => {
  it('closes the old stream and ignores its events when the query changes', () => {
    const view = renderHook(
      ({ query }) => useSessionMessageSearch('project-1', query, true),
      { initialProps: { query: 'first' } },
    );

    act(() => vi.advanceTimersByTime(250));
    const firstSource = FakeEventSource.instances[0];
    expect(firstSource?.url).toBe('/api/search?q=first');

    act(() => {
      firstSource?.emit('result', {
        projectResult: {
          projectId: 'project-1',
          projectName: 'Project',
          sessions: [{
            sessionId: 'first-session',
            provider: 'claude',
            sessionSummary: 'First result',
            matches: [{ snippet: 'first snippet' }],
          }],
        },
      });
    });
    expect(view.result.current).toHaveLength(1);

    view.rerender({ query: 'second' });
    expect(firstSource?.close).toHaveBeenCalledOnce();

    act(() => {
      firstSource?.emit('result', {
        projectResult: {
          projectId: 'project-1',
          projectName: 'Project',
          sessions: [{
            sessionId: 'stale-session',
            provider: 'claude',
            sessionSummary: 'Stale result',
            matches: [{ snippet: 'stale snippet' }],
          }],
        },
      });
    });
    expect(view.result.current.map((item) => item.sessionId)).toEqual(['first-session']);

    act(() => vi.advanceTimersByTime(250));
    expect(FakeEventSource.instances[1]?.url).toBe('/api/search?q=second');
  });

  it('does not open a stream after unmounting during the debounce delay', () => {
    const view = renderHook(() => useSessionMessageSearch('project-1', 'query', true));

    view.unmount();
    act(() => vi.advanceTimersByTime(250));

    expect(FakeEventSource.instances).toHaveLength(0);
  });
});
