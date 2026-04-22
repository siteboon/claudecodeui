import type { ReactNode } from 'react';

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-[20px] items-center justify-center rounded border border-border bg-muted/60 px-1.5 font-mono text-[10px] leading-none text-muted-foreground">
      {children}
    </kbd>
  );
}

export function KbdCombo({ keys }: { keys: string[] }) {
  return (
    <div className="flex flex-shrink-0 items-center gap-1">
      {keys.map((k, i) => (
        <Kbd key={`${k}-${i}`}>{k}</Kbd>
      ))}
    </div>
  );
}
