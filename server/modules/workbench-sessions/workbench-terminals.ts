type PtyKiller = (dir: string) => number;
let killPtys: PtyKiller = () => 0;

/** Registered by the server entrypoint so discard can release folders held by terminals. */
export function registerPtyKiller(fn: PtyKiller): void {
  killPtys = fn;
}

export function killSessionTerminals(dir: string): number {
  return killPtys(dir);
}
