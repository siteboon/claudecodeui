import type { ReactNode } from 'react';
import { cn } from '../../../lib/utils';

type SettingsRowProps = {
  label: string;
  description?: string;
  children: ReactNode;
  className?: string;
};

export default function SettingsRow({ label, description, children, className }: SettingsRowProps) {
  return (
    <div className={cn('flex items-center justify-between gap-4 px-4 py-4', className)}>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">{label}</div>
        {description && (
          <div className="mt-0.5 text-sm text-muted-foreground">{description}</div>
        )}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}
