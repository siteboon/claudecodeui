import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject, RefObject } from 'react';
import { CanvasAddon } from '@xterm/addon-canvas';
import { ClipboardAddon, type IClipboardProvider } from '@xterm/addon-clipboard';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal } from '@xterm/xterm';

import type { Project } from '../../../types/app';
import { copyTextToClipboard } from '../../../utils/clipboard';
import {
  TERMINAL_INIT_DELAY_MS,
  TERMINAL_OPTIONS,
  TERMINAL_RESIZE_DELAY_MS,
} from '../constants/constants';
import {
  installMobileTerminalSelection,
  type MobileTerminalSelectionManager,
} from '../utils/mobileTerminalSelection';
import { sendSocketMessage } from '../utils/socket';
import { ensureXtermFocusStyles } from '../utils/terminalStyles';

// CLIs running inside the pty (e.g. `claude auth login`'s "press c to copy"
// device-flow prompt) write to the clipboard via an OSC 52 escape sequence,
// not a browser event — xterm.js ignores OSC 52 unless a clipboard addon is
// loaded. Routes writes through the same fallback-aware helper the terminal's
// own selection-copy shortcut uses, since `navigator.clipboard` is often
// unavailable on self-hosted, non-HTTPS deployments.
// `ClipboardSelectionType.SYSTEM` is `'c'` (vs. `'p'` for the X11 primary
// selection) — compared as a literal since the addon ships it as a const
// enum, which isolatedModules builds (esbuild/Vite) can't import as a value.
const oscClipboardProvider: IClipboardProvider = {
  readText: async (selection) => {
    if (selection !== 'c') {
      return '';
    }
    try {
      return (await navigator.clipboard?.readText?.()) || '';
    } catch {
      return '';
    }
  },
  writeText: async (selection, text) => {
    if (selection !== 'c') {
      return;
    }
    await copyTextToClipboard(text);
  },
};

// The addon's published typings declare a single `(provider?)` constructor
// param, but the shipped runtime actually takes `(base64?, provider?)` — see
// node_modules/@xterm/addon-clipboard/lib/addon-clipboard.js. Cast to call it
// the way it's really implemented.
const ClipboardAddonCtor = ClipboardAddon as unknown as new (
  base64?: unknown,
  provider?: IClipboardProvider,
) => ClipboardAddon;

// Load an accelerated renderer, preferring WebGL and falling back to the canvas
// renderer. Both addons require `terminal.element`, so this must run *after*
// terminal.open() — loading them earlier silently threw and left the terminal on
// xterm's slow built-in DOM renderer, which is markedly heavier per scroll frame
// on mobile. If WebGL's GPU context is lost (common on mobile after the tab is
// backgrounded) we drop to canvas rather than back to the DOM renderer.
function loadTerminalRenderer(terminal: Terminal): void {
  const loadCanvas = () => {
    try {
      terminal.loadAddon(new CanvasAddon());
    } catch (error) {
      console.warn('[Shell] Canvas renderer unavailable, using DOM renderer', error);
    }
  };

  try {
    const webglAddon = new WebglAddon();
    webglAddon.onContextLoss(() => {
      webglAddon.dispose();
      loadCanvas();
    });
    terminal.loadAddon(webglAddon);
  } catch {
    console.warn('[Shell] WebGL renderer unavailable, falling back to canvas renderer');
    loadCanvas();
  }
}

type UseShellTerminalOptions = {
  terminalContainerRef: RefObject<HTMLDivElement>;
  terminalRef: MutableRefObject<Terminal | null>;
  fitAddonRef: MutableRefObject<FitAddon | null>;
  wsRef: MutableRefObject<WebSocket | null>;
  selectedProject: Project | null | undefined;
  minimal: boolean;
  isRestarting: boolean;
  closeSocket: () => void;
};

type UseShellTerminalResult = {
  isInitialized: boolean;
  clearTerminalScreen: () => void;
  disposeTerminal: () => void;
};

export function useShellTerminal({
  terminalContainerRef,
  terminalRef,
  fitAddonRef,
  wsRef,
  selectedProject,
  minimal,
  isRestarting,
  closeSocket,
}: UseShellTerminalOptions): UseShellTerminalResult {
  const [isInitialized, setIsInitialized] = useState(false);
  const resizeTimeoutRef = useRef<number | null>(null);
  const mobileSelectionRef = useRef<MobileTerminalSelectionManager | null>(null);
  const selectedProjectKey = selectedProject?.fullPath || selectedProject?.path || '';
  const hasSelectedProject = Boolean(selectedProject);

  useEffect(() => {
    ensureXtermFocusStyles();
  }, []);

  const clearTerminalScreen = useCallback(() => {
    if (!terminalRef.current) {
      return;
    }

    terminalRef.current.clear();
    terminalRef.current.write('\x1b[2J\x1b[H');
  }, [terminalRef]);

  const disposeTerminal = useCallback(() => {
    if (mobileSelectionRef.current) {
      mobileSelectionRef.current.dispose();
      mobileSelectionRef.current = null;
    }

    if (terminalRef.current) {
      terminalRef.current.dispose();
      terminalRef.current = null;
    }

    fitAddonRef.current = null;
    setIsInitialized(false);
  }, [fitAddonRef, terminalRef]);

  useEffect(() => {
    const terminalContainer = terminalContainerRef.current;
    if (!terminalContainer || !hasSelectedProject || isRestarting || terminalRef.current) {
      return;
    }

    const nextTerminal = new Terminal(TERMINAL_OPTIONS);
    terminalRef.current = nextTerminal;

    const nextFitAddon = new FitAddon();
    fitAddonRef.current = nextFitAddon;
    nextTerminal.loadAddon(nextFitAddon);

    nextTerminal.loadAddon(new ClipboardAddonCtor(undefined, oscClipboardProvider));

    // Avoid wrapped partial links in compact login flows.
    if (!minimal) {
      nextTerminal.loadAddon(new WebLinksAddon());
    }

    nextTerminal.open(terminalContainer);
    loadTerminalRenderer(nextTerminal);

    mobileSelectionRef.current = installMobileTerminalSelection(
      nextTerminal,
      terminalContainer,
      {
        onFontSizeChange: (fontSize) => {
          nextTerminal.options.fontSize = fontSize;

          const currentFitAddon = fitAddonRef.current;
          if (currentFitAddon) {
            currentFitAddon.fit();
            sendSocketMessage(wsRef.current, {
              type: 'resize',
              cols: nextTerminal.cols,
              rows: nextTerminal.rows,
            });
          } else {
            nextTerminal.refresh(0, nextTerminal.rows - 1);
          }
        },
      },
    );

    const copyTerminalSelection = async () => {
      const selection = nextTerminal.getSelection();
      if (!selection) {
        return false;
      }

      return copyTextToClipboard(selection);
    };

    const handleTerminalCopy = (event: ClipboardEvent) => {
      if (!nextTerminal.hasSelection()) {
        return;
      }

      const selection = nextTerminal.getSelection();
      if (!selection) {
        return;
      }

      event.preventDefault();

      if (event.clipboardData) {
        event.clipboardData.setData('text/plain', selection);
        return;
      }

      void copyTextToClipboard(selection);
    };

    terminalContainer.addEventListener('copy', handleTerminalCopy);

    nextTerminal.attachCustomKeyEventHandler((event) => {
      if (
        event.type === 'keydown' &&
        (event.ctrlKey || event.metaKey) &&
        event.key?.toLowerCase() === 'c' &&
        nextTerminal.hasSelection()
      ) {
        event.preventDefault();
        event.stopPropagation();
        void copyTerminalSelection();
        return false;
      }

      if (
        event.type === 'keydown' &&
        (event.ctrlKey || event.metaKey) &&
        event.key?.toLowerCase() === 'v'
      ) {
        // Block native paste so data is only injected after clipboard-read resolves.
        event.preventDefault();
        event.stopPropagation();

        if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
          navigator.clipboard
            .readText()
            .then((text) => {
              sendSocketMessage(wsRef.current, {
                type: 'input',
                data: text,
              });
            })
            .catch(() => {});
        }

        return false;
      }

      return true;
    });

    window.setTimeout(() => {
      const currentFitAddon = fitAddonRef.current;
      const currentTerminal = terminalRef.current;
      if (!currentFitAddon || !currentTerminal) {
        return;
      }

      currentFitAddon.fit();
      sendSocketMessage(wsRef.current, {
        type: 'resize',
        cols: currentTerminal.cols,
        rows: currentTerminal.rows,
      });
    }, TERMINAL_INIT_DELAY_MS);

    setIsInitialized(true);

    const dataSubscription = nextTerminal.onData((data) => {
      sendSocketMessage(wsRef.current, {
        type: 'input',
        data,
      });
    });

    const resizeObserver = new ResizeObserver(() => {
      if (resizeTimeoutRef.current !== null) {
        window.clearTimeout(resizeTimeoutRef.current);
      }

      resizeTimeoutRef.current = window.setTimeout(() => {
        const currentFitAddon = fitAddonRef.current;
        const currentTerminal = terminalRef.current;
        if (!currentFitAddon || !currentTerminal) {
          return;
        }

        currentFitAddon.fit();
        sendSocketMessage(wsRef.current, {
          type: 'resize',
          cols: currentTerminal.cols,
          rows: currentTerminal.rows,
        });
      }, TERMINAL_RESIZE_DELAY_MS);
    });

    resizeObserver.observe(terminalContainer);

    return () => {
      terminalContainer.removeEventListener('copy', handleTerminalCopy);
      resizeObserver.disconnect();
      if (resizeTimeoutRef.current !== null) {
        window.clearTimeout(resizeTimeoutRef.current);
        resizeTimeoutRef.current = null;
      }
      dataSubscription.dispose();
      closeSocket();
      disposeTerminal();
    };
  }, [
    closeSocket,
    disposeTerminal,
    fitAddonRef,
    isRestarting,
    hasSelectedProject,
    minimal,
    selectedProjectKey,
    terminalContainerRef,
    terminalRef,
    wsRef,
  ]);

  return {
    isInitialized,
    clearTerminalScreen,
    disposeTerminal,
  };
}
