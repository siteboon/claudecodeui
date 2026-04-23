import type { AppTab } from '../../types/app';

import { useAppNavItems, resolveActiveSlot, type AppNavSlot } from './useAppNavItems';

type Props = {
  activeTab: AppTab;
  sidebarOpen: boolean;
  onSelect: (slot: AppNavSlot) => void;
};

/**
 * Persistent 64px left rail shown at lg+ (≥1024px). Same five slots as the
 * mobile tab bar but stacked vertically, icons-only. Active slot adopts the
 * Midnight `nav-pill-active` treatment.
 */
export default function DesktopRail({ activeTab, sidebarOpen, onSelect }: Props) {
  const items = useAppNavItems();
  const activeSlot = resolveActiveSlot({ activeTab, sidebarOpen });

  return (
    <aside
      aria-label="Primary navigation"
      className="hidden w-rail shrink-0 flex-col items-center gap-1 border-r border-midnight-border py-4 lg:flex"
      style={{ background: 'var(--midnight-surface-1)' }}
    >
      <div className="mt-2 flex flex-col gap-1" role="tablist">
        {items.map(({ slot, label, Icon, accent }) => {
          const isActive = slot === activeSlot;
          return (
            <button
              key={slot}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-label={label}
              title={label}
              data-accent={accent}
              onClick={() => onSelect(slot)}
              className={`flex h-11 w-11 items-center justify-center rounded-midnight-control text-midnight-text2 transition-colors hover:text-midnight-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                isActive ? 'nav-pill-active text-foreground' : ''
              }`}
            >
              <Icon width={20} height={20} strokeWidth={2} aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </aside>
  );
}
