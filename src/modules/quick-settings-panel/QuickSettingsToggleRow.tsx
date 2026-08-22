import { memo } from 'react';
import type { LucideIcon } from 'lucide-react';

import { SETTING_ROW_CLASS } from '@/shared/constants';

const TOGGLE_ROW_CLASS = `${SETTING_ROW_CLASS} cursor-pointer`;

const CHECKBOX_CLASS =
  'h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 dark:text-blue-500 focus:ring-blue-500 focus:ring-2 dark:focus:ring-blue-400 bg-gray-100 dark:bg-gray-800 checked:bg-blue-600 dark:checked:bg-blue-600';

type QuickSettingsToggleRowProps = {
  label: string;
  icon: LucideIcon;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
};

/** Rendered by QuickSettingsContent as one labelled checkbox row for a boolean preference. */
function QuickSettingsToggleRow({
  label,
  icon: Icon,
  checked,
  onCheckedChange,
}: QuickSettingsToggleRowProps) {
  return (
    <label className={TOGGLE_ROW_CLASS}>
      <span className="flex items-center gap-2 text-sm text-foreground">
        <Icon className="h-4 w-4 text-muted-foreground" />
        {label}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onCheckedChange(event.target.checked)}
        className={CHECKBOX_CLASS}
      />
    </label>
  );
}

export default memo(QuickSettingsToggleRow);
