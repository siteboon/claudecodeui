import type { MobileMenuButtonProps } from './types';
import { useMobileMenuHandlers } from '../../hooks/main-content/useMobileMenuHandlers';

export default function MobileMenuButton({ onMenuClick, compact = false }: MobileMenuButtonProps) {
  const { handleMobileMenuClick, handleMobileMenuTouchEnd } = useMobileMenuHandlers(onMenuClick);

  const buttonClasses = compact
    ? 'p-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 pwa-menu-button'
    : 'p-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 touch-manipulation active:scale-95 pwa-menu-button flex-shrink-0';

  return (
    <button
      onClick={handleMobileMenuClick}
      onTouchEnd={handleMobileMenuTouchEnd}
      className={buttonClasses}
      aria-label="Open menu"
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    </button>
  );
}
