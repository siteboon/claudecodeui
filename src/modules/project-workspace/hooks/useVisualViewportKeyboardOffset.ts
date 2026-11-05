import { useEffect } from 'react';

/** Keeps the fixed workspace shell above the virtual keyboard in iOS Safari. */
export function useVisualViewportKeyboardOffset() {
  useEffect(() => {
    const visualViewport = window.visualViewport;
    if (!visualViewport) {
      return undefined;
    }

    const isEditable = (el: Element | null): boolean =>
      !!el &&
      (el.tagName === 'INPUT' ||
        el.tagName === 'TEXTAREA' ||
        (el as HTMLElement).isContentEditable);

    // Without a focused editable element there is no keyboard, so a stale
    // viewport reading must never keep the shell lifted. iOS Safari does not
    // reliably emit a visualViewport resize when the keyboard hides after a
    // send (the composer re-render moves focus), which left the composer
    // stranded mid-screen with the bottom half of the page empty.
    const update = () => {
      const keyboardHeight = isEditable(document.activeElement)
        ? Math.max(0, window.innerHeight - visualViewport.height)
        : 0;
      document.documentElement.style.setProperty('--keyboard-height', `${keyboardHeight}px`);
    };

    // Focus changes race the keyboard animation, and the visualViewport
    // values stay live even when its events go missing — so re-read them
    // once the animation (~250ms on both platforms) has settled.
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const later = (ms: number) => {
      const t = setTimeout(() => {
        timers.delete(t);
        update();
      }, ms);
      timers.add(t);
    };
    const settle = () => {
      update();
      later(250);
      later(600);
    };

    visualViewport.addEventListener('resize', update);
    visualViewport.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', settle);
    document.addEventListener('focusin', settle);
    document.addEventListener('focusout', settle);
    return () => {
      timers.forEach(clearTimeout);
      visualViewport.removeEventListener('resize', update);
      visualViewport.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', settle);
      document.removeEventListener('focusin', settle);
      document.removeEventListener('focusout', settle);
    };
  }, []);
}
