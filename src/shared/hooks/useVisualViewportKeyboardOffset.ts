import { useEffect } from 'react';

/**
 * Keeps `--keyboard-height` on the document root equal to the height of the
 * on-screen keyboard, so fixed UI can stay above it in iOS Safari, which does
 * not shrink the layout viewport for the keyboard.
 *
 * Used by the project-workspace module (the workspace shell's bottom edge) and
 * the shell module (the floating terminal key bar, which can be open outside
 * the workspace, e.g. in the onboarding provider-login modal). Several mounted
 * instances write the same value, so mounting it again is harmless.
 */
export function useVisualViewportKeyboardOffset() {
  useEffect(() => {
    const visualViewport = window.visualViewport;
    if (!visualViewport) {
      return undefined;
    }

    const updateKeyboardHeight = () => {
      const keyboardHeight = Math.max(0, window.innerHeight - visualViewport.height);
      document.documentElement.style.setProperty('--keyboard-height', `${keyboardHeight}px`);
    };

    visualViewport.addEventListener('resize', updateKeyboardHeight);
    return () => visualViewport.removeEventListener('resize', updateKeyboardHeight);
  }, []);
}
