import type { Terminal } from '@xterm/xterm';
import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import TerminalShortcutsPanel from '@/modules/shell/TerminalShortcutsPanel';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

/** Renders the key bar with the given placement and returns its outer wrapper. */
function renderPanel(placement: 'inline' | 'floating') {
  const { container } = render(
    <TerminalShortcutsPanel
      wsRef={{ current: null }}
      terminalRef={{ current: null as Terminal | null }}
      isConnected
      placement={placement}
    />,
  );
  return container.firstElementChild as HTMLElement;
}

describe('TerminalShortcutsPanel placement', () => {
  it('takes its own row when inline, so it neither covers the terminal nor hides behind the iOS keyboard', () => {
    const panel = renderPanel('inline');

    expect(panel.className).not.toMatch(/\bfixed\b/);
    expect(panel.className).toMatch(/\bshrink-0\b/);
    expect(panel.style.transform).toBe('');
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'visualViewport');
    document.documentElement.style.removeProperty('--keyboard-height');
  });

  it('tracks the keyboard height itself, for when no workspace is mounted (onboarding)', () => {
    const visualViewport = Object.assign(new EventTarget(), { height: window.innerHeight });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: visualViewport });
    renderPanel('floating');

    act(() => {
      visualViewport.height = window.innerHeight - 300;
      visualViewport.dispatchEvent(new Event('resize'));
    });

    expect(document.documentElement.style.getPropertyValue('--keyboard-height')).toBe('300px');
  });

  it('picks up a keyboard that is already open when it mounts', () => {
    const visualViewport = Object.assign(new EventTarget(), { height: window.innerHeight - 250 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: visualViewport });
    renderPanel('floating');

    expect(document.documentElement.style.getPropertyValue('--keyboard-height')).toBe('250px');
  });

  it('floats over the bottom of the screen and is lifted by the keyboard height', () => {
    const panel = renderPanel('floating');

    expect(panel.className).toMatch(/\bfixed\b/);
    expect(panel.style.transform).toContain('var(--keyboard-height');
  });
});
