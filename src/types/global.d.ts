export {};

declare global {
  interface Window {
    __ROUTER_BASENAME__?: string;
  }

  interface EventSourceEventMap {
    result: MessageEvent;
    progress: MessageEvent;
    done: MessageEvent;
    auth_refresh: MessageEvent;
  }
}
