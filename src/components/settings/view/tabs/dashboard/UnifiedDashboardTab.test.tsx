import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import UnifiedDashboardTab from './UnifiedDashboardTab';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
});

describe('UnifiedDashboardTab', () => {
  it('renders section headings for all three services', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ health: { reachable: false }, accounts: [], usage: { totalRequests: 0, totalTokens: 0, totalCostUsd: 0 } }),
    });

    render(<UnifiedDashboardTab />);
    expect(screen.getByText(/9router/i)).toBeDefined();
    expect(screen.getByText(/openclaude/i)).toBeDefined();
    expect(screen.getByText(/crewai/i)).toBeDefined();
  });

  it('shows 9Router connected status when reachable', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('9router')) {
        return {
          ok: true,
          json: async () => ({
            health: { reachable: true, port: 20128 },
            accounts: [
              { id: 'acc-1', provider: 'anthropic', name: 'Account 1', active: true },
              { id: 'acc-2', provider: 'anthropic', name: 'Account 2', active: true },
            ],
            usage: { totalRequests: 150, totalTokens: 50000, totalCostUsd: 1.23 },
          }),
        };
      }
      return { ok: true, json: async () => ({ sessions: [] }) };
    });

    render(<UnifiedDashboardTab />);
    await waitFor(() => {
      expect(screen.getByText(/connected/i)).toBeDefined();
    });
    expect(screen.getByText(/account 1/i)).toBeDefined();
    expect(screen.getByText(/account 2/i)).toBeDefined();
  });

  it('shows OpenClaude sessions when available', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('openclaude')) {
        return {
          ok: true,
          json: async () => ({
            sessions: [
              { id: 'sess-1', projectName: 'my-project', messageCount: 12, lastModified: '2025-06-01T00:00:00Z' },
            ],
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({ health: { reachable: false }, accounts: [], usage: { totalRequests: 0, totalTokens: 0, totalCostUsd: 0 } }),
      };
    });

    render(<UnifiedDashboardTab />);
    await waitFor(() => {
      expect(screen.getByText(/my-project/i)).toBeDefined();
    });
    expect(screen.getByText(/12 messages/i)).toBeDefined();
  });

  it('renders CrewAISummary when crewai API returns active agents', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('crewai')) {
        return {
          ok: true,
          json: async () => ({
            activeRunIds: ['run-1'],
            agents: [
              { role: 'Researcher', status: 'working', task: 'Gathering data' },
              { role: 'Writer', status: 'idle' },
            ],
            crewName: 'Research Crew',
          }),
        };
      }
      if (url.includes('9router')) {
        return {
          ok: true,
          json: async () => ({ health: { reachable: false }, accounts: [], usage: { totalRequests: 0, totalTokens: 0, totalCostUsd: 0 } }),
        };
      }
      return { ok: true, json: async () => ({ sessions: [] }) };
    });

    render(<UnifiedDashboardTab />);
    await waitFor(() => {
      expect(screen.getByText('Research Crew')).toBeDefined();
    });
    expect(screen.getByText('Researcher')).toBeDefined();
    expect(screen.getByText('Writer')).toBeDefined();
  });

  it('shows empty state messages when services have no data', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('9router')) {
        return {
          ok: true,
          json: async () => ({ health: { reachable: false }, accounts: [], usage: { totalRequests: 0, totalTokens: 0, totalCostUsd: 0 } }),
        };
      }
      if (url.includes('openclaude')) {
        return { ok: true, json: async () => ({ sessions: [] }) };
      }
      return { ok: false };
    });

    render(<UnifiedDashboardTab />);
    await waitFor(() => {
      expect(screen.getByText(/not connected/i)).toBeDefined();
    });
    expect(screen.getByText(/no sessions/i)).toBeDefined();
  });
});
