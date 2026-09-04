import type { ReactNode } from 'react';

import { cn } from '@/shared/utils';

type SettingsCardProps = {
  children: ReactNode;
  className?: string;
  divided?: boolean;
};

/** Used by the settings module's appearance, browser-use, git and tasks tabs to group related rows in a card. */
export default function SettingsCard({ children, className, divided }: SettingsCardProps) {
  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-card/50',
        divided && 'divide-y divide-border',
        className,
      )}
    >
      {children}
    </div>
  );
}
