import { useEffect } from 'react';

/** Keeps the fixed workspace shell above the virtual keyboard in iOS Safari. */
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
