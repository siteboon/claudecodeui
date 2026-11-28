const COMPLETION_TITLE_INDICATOR = '[Done]';
/**
 * A run that stopped to ask the user something is not "done" — it is blocked.
 * The two states share this module's clear-on-return behaviour but must not
 * share a label, or the tab would claim a finished run while it waits.
 */
const ATTENTION_TITLE_INDICATOR = '[Action required]';
const TITLE_INDICATORS = [ATTENTION_TITLE_INDICATOR, COMPLETION_TITLE_INDICATOR];
const TITLE_INDICATOR_CLEAR_DELAY_MS = 2000;

let clearTimer: number | null = null;
let returnListenersAttached = false;

const indicatorPrefixOf = (title: string): string | null => {
  const indicator = TITLE_INDICATORS.find((candidate) => title.startsWith(`${candidate} `));
  return indicator ? `${indicator} ` : null;
};

const stripIndicator = (title: string): string => {
  const prefix = indicatorPrefixOf(title);
  return prefix ? title.slice(prefix.length) : title;
};

const pageIsActive = (): boolean => (
  document.visibilityState === 'visible' && document.hasFocus()
);

const removeReturnListeners = (): void => {
  if (!returnListenersAttached || typeof window === 'undefined') {
    return;
  }

  document.removeEventListener('visibilitychange', handleUserReturn);
  window.removeEventListener('focus', handleUserReturn, true);
  window.removeEventListener('click', handleUserReturn, true);
  returnListenersAttached = false;
};

const clearTitleIndicator = (): void => {
  if (clearTimer !== null) {
    window.clearTimeout(clearTimer);
    clearTimer = null;
  }

  removeReturnListeners();
  removePageInactiveListener();

  if (indicatorPrefixOf(document.title)) {
    document.title = stripIndicator(document.title);
  }
};

const removePageInactiveListener = (): void => {
  document.removeEventListener('visibilitychange', handlePageInactive);
};

const scheduleClear = (): void => {
  if (clearTimer !== null) {
    window.clearTimeout(clearTimer);
  }

  clearTimer = window.setTimeout(() => {
    clearTitleIndicator();
  }, TITLE_INDICATOR_CLEAR_DELAY_MS);

  removePageInactiveListener();
  document.addEventListener('visibilitychange', handlePageInactive, { once: true });
};

function handleUserReturn(): void {
  if (!pageIsActive()) {
    return;
  }

  // Background completions keep the marker indefinitely. A tab click normally
  // surfaces as visibility/focus, while an in-page click is a useful fallback.
  scheduleClear();
}

function handlePageInactive(): void {
  if (document.visibilityState !== 'hidden') {
    return;
  }

  if (clearTimer !== null) {
    window.clearTimeout(clearTimer);
    clearTimer = null;
  }

  if (!returnListenersAttached) {
    document.addEventListener('visibilitychange', handleUserReturn);
    window.addEventListener('focus', handleUserReturn, true);
    window.addEventListener('click', handleUserReturn, true);
    returnListenersAttached = true;
  }
}

const showTitleIndicator = (indicator: string): void => {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return;
  }

  const baseTitle = stripIndicator(document.title || 'CloudCLI UI');
  document.title = `${indicator} ${baseTitle}`;

  if (pageIsActive()) {
    scheduleClear();
    return;
  }

  if (clearTimer !== null) {
    window.clearTimeout(clearTimer);
    clearTimer = null;
  }

  if (!returnListenersAttached) {
    document.addEventListener('visibilitychange', handleUserReturn);
    window.addEventListener('focus', handleUserReturn, true);
    window.addEventListener('click', handleUserReturn, true);
    returnListenersAttached = true;
  }
};

/** A run finished: the tab says so while the user is elsewhere. */
export const showCompletionTitleIndicator = (): void => {
  showTitleIndicator(COMPLETION_TITLE_INDICATOR);
};

/** A run stopped to wait for the user, in a session they are not looking at. */
export const showAttentionTitleIndicator = (): void => {
  showTitleIndicator(ATTENTION_TITLE_INDICATOR);
};
