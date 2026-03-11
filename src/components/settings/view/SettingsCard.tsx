import type { ReactNode } from 'react';
import { cn } from '../../../lib/utils';

type SettingsCardProps = {
  children: ReactNode;
  className?: string;
  divided?: boolean;
};

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
