import type { AppTab } from '../../types/app';

import { useAppNavItems, resolveActiveSlot, type AppNavSlot } from './useAppNavItems';

type Props = {
  activeTab: AppTab;
  sidebarOpen: boolean;
  onSelect: (slot: AppNavSlot) => void;
};

/**
 * Bottom tab bar shown below 1024px. Five slots — Chat / Sessions / Preview /
 * Browser / More. Uses Midnight `.ds-tabbar*` classes; icons from lucide-react.
 * Respects `env(safe-area-inset-bottom)` via `.ios-bottom-safe` wrapper.
 */
export default function MobileTabBar({ activeTab, sidebarOpen, onSelect }: Props) {
  const items = useAppNavItems();
  const activeSlot = resolveActiveSlot({ activeTab, sidebarOpen });

  return (
    <nav
      aria-label="Primary"
      className="ios-bottom-safe fixed inset-x-0 bottom-0 z-40 lg:hidden"
      style={{ paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)' }}
    >
      <div className="mx-3 mb-2">
        <div className="ds-tabbar">
          {items.map(({ slot, label, Icon, accent }) => {
            const isActive = slot === activeSlot;
            return (
              <button
                key={slot}
                type="button"
                onClick={() => onSelect(slot)}
                aria-label={label}
                aria-current={isActive ? 'page' : undefined}
                data-accent={accent}
                className={`ds-tabbar-item mobile-touch-target ${isActive ? 'ds-tabbar-item-active' : ''}`}
              >
                <span className="ds-tabbar-pill">
                  <Icon width={18} height={18} strokeWidth={2} />
                </span>
                {isActive && <span className="ds-tabbar-label">{label}</span>}
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
