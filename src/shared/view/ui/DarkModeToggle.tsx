import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../../../contexts/ThemeContext';

type DarkModeToggleProps = {
  checked?: boolean;
  onToggle?: (nextValue: boolean) => void;
  ariaLabel?: string;
};

function DarkModeToggle({
  checked,
  onToggle,
  ariaLabel = 'Toggle dark mode',
}: DarkModeToggleProps) {
  const { isDarkMode, toggleDarkMode } = useTheme();
  // Support controlled usage while keeping ThemeContext as the default source of truth.
  const isControlled = typeof checked === 'boolean' && typeof onToggle === 'function';
  const isEnabled = isControlled ? checked : isDarkMode;

  const handleToggle = () => {
    if (isControlled && onToggle) {
      onToggle(!isEnabled);
      return;
    }

    toggleDarkMode();
  };

  return (
    <button
      onClick={handleToggle}
      className="relative inline-flex h-8 w-14 items-center rounded-full bg-gray-200 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:bg-gray-700 dark:focus:ring-offset-gray-900"
      role="switch"
      aria-checked={isEnabled}
      aria-label={ariaLabel}
    >
      <span className="sr-only">{ariaLabel}</span>
      <span
        className={`${
          isEnabled ? 'translate-x-7' : 'translate-x-1'
        } flex h-6 w-6 transform items-center justify-center rounded-full bg-white shadow-lg transition-transform duration-200`}
      >
        {isEnabled ? (
          <Moon className="h-3.5 w-3.5 text-gray-700" />
        ) : (
          <Sun className="h-3.5 w-3.5 text-yellow-500" />
        )}
      </span>
    </button>
  );
}

export default DarkModeToggle;
