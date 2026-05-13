export {};

declare global {
  interface Window {
    __ROUTER_BASENAME__?: string;
    updateProjectBranch?: (projectId: string, branchName: string) => void;
  }

  interface EventSourceEventMap {
    result: MessageEvent;
    progress: MessageEvent;
    done: MessageEvent;
  }
}
