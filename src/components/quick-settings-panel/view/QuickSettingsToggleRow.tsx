import { memo } from 'react';
import type { LucideIcon } from 'lucide-react';
import { CHECKBOX_CLASS, TOGGLE_ROW_CLASS } from '../constants';

type QuickSettingsToggleRowProps = {
  label: string;
  icon: LucideIcon;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
};

function QuickSettingsToggleRow({
  label,
  icon: Icon,
  checked,
  onCheckedChange,
}: QuickSettingsToggleRowProps) {
  return (
    <label className={TOGGLE_ROW_CLASS}>
      <span className="flex items-center gap-2 text-sm text-gray-900 dark:text-white">
        <Icon className="h-4 w-4 text-gray-600 dark:text-gray-400" />
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
