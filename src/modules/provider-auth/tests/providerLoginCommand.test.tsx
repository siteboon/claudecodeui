import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ProviderLoginModal from '@/modules/provider-auth/ProviderLoginModal';

// Issue #641: the Claude login terminal ran `claude --dangerously-skip-permissions
// /login`. Claude Code exits with code 1 on that flag when it runs as root, so a
// server started as root could never log in from the UI. `/login` needs no
// permission flag, so the command must not carry one.

const { launchedCommands } = vi.hoisted(() => ({ launchedCommands: [] as string[] }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/modules/standalone-shell', () => ({
  StandaloneShell: ({ command }: { command: string }) => {
    launchedCommands.push(command);
    return null;
  },
}));

describe('ProviderLoginModal login command', () => {
  beforeEach(() => {
    launchedCommands.length = 0;
  });

  it('runs the Claude login without the bypass-permissions flag', () => {
    render(<ProviderLoginModal isOpen onClose={() => {}} provider="claude" />);

    expect(launchedCommands).toEqual(['claude /login']);
  });

  it('keeps the Claude login without the flag for an already authenticated account', () => {
    render(<ProviderLoginModal isOpen onClose={() => {}} provider="claude" isAuthenticated />);

    expect(launchedCommands).toEqual(['claude /login']);
    expect(launchedCommands.join(' ')).not.toContain('--dangerously-skip-permissions');
  });

  it('leaves the other providers\' login commands alone', () => {
    render(<ProviderLoginModal isOpen onClose={() => {}} provider="cursor" />);
    render(<ProviderLoginModal isOpen onClose={() => {}} provider="opencode" />);

    expect(launchedCommands).toEqual(['cursor-agent login', 'opencode auth login']);
  });
});
