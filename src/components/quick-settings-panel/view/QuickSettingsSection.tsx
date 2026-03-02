import type { ReactNode } from 'react';

type QuickSettingsSectionProps = {
  title: string;
  children: ReactNode;
  className?: string;
};

export default function QuickSettingsSection({
  title,
  children,
  className = '',
}: QuickSettingsSectionProps) {
  return (
    <div className={`space-y-2 ${className}`}>
      <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
        {title}
      </h4>
      {children}
    </div>
  );
}
