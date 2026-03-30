export {};

declare global {
  interface Window {
    refreshProjects?: () => void | Promise<void>;
    openSettings?: (tab?: string) => void;
  }

  interface EventSourceEventMap {
    result: MessageEvent;
    progress: MessageEvent;
    done: MessageEvent;
  }
}
