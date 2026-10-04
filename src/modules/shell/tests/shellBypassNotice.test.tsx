import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/modules/i18n';
import Shell from '@/modules/shell/Shell';
import type { Project } from '@/shared/types';

// As root, Claude Code exits on the bypass flag, so the server starts it
// without the flag and reports that on the shell socket (#641). The CLI's
// full-screen UI clears the terminal, so the Shell draws the notice as a
// banner of its own. The terminal and the socket are stubbed one layer below
// `useShellRuntime`, so the runtime hook and the Shell around it stay real.
const shellHooks = vi.hoisted(() => ({
  connection: {
    isConnected: true,
    isConnecting: false,
    isBypassRefusedAsRoot: false,
    closeSocket: () => {},
    connectToShell: () => {},
    disconnectFromShell: () => {},
  },
  terminal: {
    isInitialized: true,
    clearTerminalScreen: () => {},
    disposeTerminal: () => {},
  },
}));

vi.mock('@/modules/shell/hooks/useShellConnection', () => ({
  useShellConnection: () => ({ ...shellHooks.connection }),
}));

vi.mock('@/modules/shell/hooks/useShellTerminal', () => ({
  useShellTerminal: () => shellHooks.terminal,
}));

// The Shell seeds its Bypass toggle from the chat composer's saved setting.
vi.mock('@/modules/chat', () => ({
  getClaudeSettings: () => ({ skipPermissions: true }),
}));

const project: Project = { projectId: 'demo', displayName: 'demo', fullPath: '/srv/demo', path: '/srv/demo' };

describe('the Shell root bypass banner', () => {
  afterEach(async () => {
    shellHooks.connection.isBypassRefusedAsRoot = false;
    await i18n.changeLanguage('en');
  });

  it('says outside the terminal why bypass was not applied', () => {
    shellHooks.connection.isBypassRefusedAsRoot = true;

    render(<Shell selectedProject={project} />);

    expect(screen.getByRole('status').textContent).toMatch(
      /^Bypass permissions was not applied: CloudCLI is running as root/,
    );
  });

  it('is drawn in the reader language', async () => {
    await i18n.changeLanguage('de');
    shellHooks.connection.isBypassRefusedAsRoot = true;

    render(<Shell selectedProject={project} />);

    expect(screen.getByRole('status').textContent).toMatch(/^Berechtigungen umgehen wurde nicht angewendet/);
  });

  it('is absent while no refusal is reported', () => {
    render(<Shell selectedProject={project} />);

    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText(/Bypass permissions was not applied/)).toBeNull();
  });
});
