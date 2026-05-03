import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { NineRouterStatus } from './NineRouterStatus';

const mockSendMessage = vi.fn();
vi.mock('../../contexts/WebSocketContext', () => ({
  useWebSocket: () => ({ sendMessage: mockSendMessage, isConnected: true, ws: null, latestMessage: null }),
}));

const PREFERENCE_KEY = 'cloudcli.9router.preferredAccountId';

const fixture = {
  connected: {
    health: { reachable: true, port: 20128, status: 'ok' },
    accounts: [
      { id: 'a1', provider: 'anthropic', name: 'Avi Primary', active: true, testStatus: 'success' },
      { id: 'a2', provider: 'anthropic', name: 'Avi Secondary', active: true, testStatus: 'unknown' },
    ],
    usage: { totalRequests: 142, totalTokens: 95800, totalCostUsd: 1.27, perAccount: {} },
  },
  disconnected: {
    health: { reachable: false, port: 20128, error: 'ECONNREFUSED' },
    accounts: [],
    usage: { totalRequests: 0, totalTokens: 0, totalCostUsd: 0, perAccount: {} },
  },
};

const stubFetch = (impl: (url: string) => Promise<Response> | Response) => {
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    return Promise.resolve(impl(url));
  }));
};

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('NineRouterStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockSendMessage.mockClear();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test('fetches /api/9router/status on mount', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(fixture.connected)));
    vi.stubGlobal('fetch', fetchMock);

    render(<NineRouterStatus />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/9router/status', expect.any(Object));
    });
  });

  test('renders connected state with port when 9Router is reachable', async () => {
    stubFetch(() => jsonResponse(fixture.connected));

    render(<NineRouterStatus />);

    expect(await screen.findByRole('status')).toHaveAttribute('data-state', 'connected');
    expect(screen.getByText(/9Router/i)).toBeInTheDocument();
    expect(screen.getByText(/:20128/)).toBeInTheDocument();
  });

  test('renders disconnected state when 9Router is not reachable', async () => {
    stubFetch(() => jsonResponse(fixture.disconnected));

    render(<NineRouterStatus />);

    const status = await screen.findByRole('status');
    expect(status).toHaveAttribute('data-state', 'disconnected');
    expect(screen.getByText(/not connected/i)).toBeInTheDocument();
  });

  test('renders disconnected state when fetch itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('Network error'))));

    render(<NineRouterStatus />);

    const status = await screen.findByRole('status');
    expect(status).toHaveAttribute('data-state', 'disconnected');
  });

  test('renders disconnected state on non-2xx response', async () => {
    stubFetch(() => jsonResponse({ error: 'unauthorized' }, 401));

    render(<NineRouterStatus />);

    const status = await screen.findByRole('status');
    expect(status).toHaveAttribute('data-state', 'disconnected');
  });

  test('shows account count when accounts are loaded', async () => {
    stubFetch(() => jsonResponse(fixture.connected));

    render(<NineRouterStatus />);

    await waitFor(() => {
      expect(screen.getByTestId('nine-router-account-count')).toHaveTextContent('2');
    });
  });

  test('shows total request count when usage is loaded', async () => {
    stubFetch(() => jsonResponse(fixture.connected));

    render(<NineRouterStatus />);

    await waitFor(() => {
      expect(screen.getByTestId('nine-router-usage-requests')).toHaveTextContent('142');
    });
  });

  test('renders loading state before first fetch resolves', () => {
    let resolve: (response: Response) => void = () => {};
    const pending = new Promise<Response>((r) => {
      resolve = r;
    });
    vi.stubGlobal('fetch', vi.fn(() => pending));

    render(<NineRouterStatus />);

    expect(screen.getByRole('status')).toHaveAttribute('data-state', 'loading');

    resolve(jsonResponse(fixture.connected));
  });

  test('aborts in-flight request on unmount', async () => {
    let receivedSignal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
        receivedSignal = init?.signal as AbortSignal | undefined;
        return new Promise<Response>(() => {
          // never resolves
        });
      }),
    );

    const { unmount } = render(<NineRouterStatus />);
    unmount();

    expect(receivedSignal?.aborted).toBe(true);
  });

  // ─── Account picker behavior ────────────────────────────────

  test('picker is hidden by default', async () => {
    stubFetch(() => jsonResponse(fixture.connected));

    render(<NineRouterStatus />);
    await screen.findByRole('status');

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  test('clicking the chip opens the account picker', async () => {
    stubFetch(() => jsonResponse(fixture.connected));

    render(<NineRouterStatus />);
    const trigger = await screen.findByRole('button', { name: /9router/i });

    fireEvent.click(trigger);

    expect(await screen.findByRole('listbox')).toBeInTheDocument();
  });

  test('picker lists Auto + every account from /api/9router/status', async () => {
    stubFetch(() => jsonResponse(fixture.connected));

    render(<NineRouterStatus />);
    fireEvent.click(await screen.findByRole('button', { name: /9router/i }));

    const listbox = await screen.findByRole('listbox');
    const options = listbox.querySelectorAll('[role="option"]');
    expect(options).toHaveLength(3);
    expect(options[0]).toHaveTextContent(/auto/i);
    expect(options[1]).toHaveTextContent('Avi Primary');
    expect(options[2]).toHaveTextContent('Avi Secondary');
  });

  test('selecting an account dispatches set-account WS message and persists to localStorage', async () => {
    stubFetch(() => jsonResponse(fixture.connected));

    render(<NineRouterStatus />);
    fireEvent.click(await screen.findByRole('button', { name: /9router/i }));
    const option = await screen.findByRole('option', { name: 'Avi Primary' });
    fireEvent.click(option);

    expect(mockSendMessage).toHaveBeenCalledWith({ type: 'set-account', accountId: 'a1' });
    expect(window.localStorage.getItem(PREFERENCE_KEY)).toBe('a1');
  });

  test('selecting Auto sends null accountId and clears localStorage', async () => {
    window.localStorage.setItem(PREFERENCE_KEY, 'a1');
    stubFetch(() => jsonResponse(fixture.connected));

    render(<NineRouterStatus />);
    fireEvent.click(await screen.findByRole('button', { name: /9router/i }));
    fireEvent.click(await screen.findByRole('option', { name: /auto/i }));

    expect(mockSendMessage).toHaveBeenCalledWith({ type: 'set-account', accountId: null });
    expect(window.localStorage.getItem(PREFERENCE_KEY)).toBeNull();
  });

  test('selected account is marked aria-selected', async () => {
    stubFetch(() => jsonResponse(fixture.connected));

    render(<NineRouterStatus />);
    fireEvent.click(await screen.findByRole('button', { name: /9router/i }));
    fireEvent.click(await screen.findByRole('option', { name: 'Avi Secondary' }));
    // picker closes after selection
    fireEvent.click(screen.getByRole('button', { name: /9router/i })); // reopen

    const selected = await screen.findByRole('option', { name: 'Avi Secondary' });
    expect(selected).toHaveAttribute('aria-selected', 'true');
  });

  test('on mount, restores preference from localStorage and sends set-account', async () => {
    window.localStorage.setItem(PREFERENCE_KEY, 'a2');
    stubFetch(() => jsonResponse(fixture.connected));

    render(<NineRouterStatus />);

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith({ type: 'set-account', accountId: 'a2' });
    });
  });

  test('clicking the chip a second time closes the picker', async () => {
    stubFetch(() => jsonResponse(fixture.connected));

    render(<NineRouterStatus />);
    const trigger = await screen.findByRole('button', { name: /9router/i });

    fireEvent.click(trigger);
    expect(await screen.findByRole('listbox')).toBeInTheDocument();

    fireEvent.click(trigger);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  test('picker is not opened when 9Router is disconnected', async () => {
    stubFetch(() => jsonResponse(fixture.disconnected));

    render(<NineRouterStatus />);
    const trigger = await screen.findByRole('button', { name: /9router/i });

    fireEvent.click(trigger);

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
