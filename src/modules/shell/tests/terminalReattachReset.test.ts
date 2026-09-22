import { renderHook } from '@testing-library/react';
import type { MutableRefObject, RefObject } from 'react';
import type { FitAddon } from '@xterm/addon-fit';
import type { Terminal } from '@xterm/xterm';
import { describe, expect, it, vi } from 'vitest';

import { useShellTerminal } from '@/modules/shell/hooks/useShellTerminal';
import type { Project } from '@/shared/types';

const ref = <T,>(value: T): MutableRefObject<T> => ({ current: value });

/**
 * Seeding `terminalRef` makes the creation effect bail out, so the hook runs
 * against this stub instead of constructing a real xterm Terminal (which would
 * need a canvas/WebGL context jsdom does not provide).
 */
function renderTerminalHook() {
  const reset = vi.fn();
  const clear = vi.fn();
  const write = vi.fn();
  const dispose = vi.fn();
  const terminalRef = ref({ reset, clear, write, dispose } as unknown as Terminal | null);

  const view = renderHook(() =>
    useShellTerminal({
      terminalContainerRef: ref<HTMLDivElement | null>(null) as RefObject<HTMLDivElement>,
      terminalRef,
      fitAddonRef: ref<FitAddon | null>(null),
      wsRef: ref<WebSocket | null>(null),
      selectedProject: { fullPath: '/work/repo', path: '/work/repo' } as Project,
      minimal: false,
      isRestarting: false,
      closeSocket: vi.fn(),
    }),
  );

  return { view, reset, clear, write };
}

describe('terminal state on reattach', () => {
  it('fully resets the reused terminal so no mode survives into the replayed output', () => {
    const { view, reset } = renderTerminalHook();

    view.result.current.clearTerminalScreen();

    // RIS is the only call that drops the alternate screen, the DECSTBM
    // scroll region and the SGR state a statusline leaves behind; clearing
    // the buffer alone is what garbled the replay.
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('does not rely on a buffer-only clear, which leaves terminal modes set', () => {
    const { view, clear, write } = renderTerminalHook();

    view.result.current.clearTerminalScreen();

    expect(clear).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('is a no-op once the terminal has been disposed', () => {
    const { view, reset } = renderTerminalHook();

    view.result.current.disposeTerminal();
    view.result.current.clearTerminalScreen();

    expect(reset).not.toHaveBeenCalled();
  });
});
