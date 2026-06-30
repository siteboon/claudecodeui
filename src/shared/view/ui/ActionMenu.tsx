import * as React from 'react';
import { ChevronDown, Loader2, type LucideIcon } from 'lucide-react';

import { cn } from '../../../lib/utils';

import { Button } from './Button';

type ButtonVariant = 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
type ButtonSize = 'default' | 'sm' | 'lg' | 'icon';

export type ActionMenuItem = {
  key: string;
  label: string;
  description?: string;
  icon?: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
  loading?: boolean;
  isDanger?: boolean;
  showDividerBefore?: boolean;
};

type ActionMenuProps = {
  label: string;
  items: ActionMenuItem[];
  icon?: LucideIcon;
  ariaLabel?: string;
  align?: 'left' | 'right';
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  triggerClassName?: string;
  disabled?: boolean;
};

export default function ActionMenu({
  label,
  items,
  icon: TriggerIcon,
  ariaLabel,
  align = 'right',
  variant = 'outline',
  size = 'sm',
  className,
  triggerClassName,
  disabled,
}: ActionMenuProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const menuId = React.useId();

  React.useEffect(() => {
    if (!isOpen) {
      return;
    }

    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current && !rootRef.current.contains(target)) {
        setIsOpen(false);
      }
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isOpen]);

  const runItem = (item: ActionMenuItem) => {
    if (item.disabled || item.loading) {
      return;
    }

    setIsOpen(false);
    item.onSelect();
  };

  return (
    <div ref={rootRef} className={cn('relative inline-flex', className)}>
      <Button
        type="button"
        variant={variant}
        size={size}
        className={triggerClassName}
        disabled={disabled}
        aria-label={ariaLabel || label}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
        onClick={() => setIsOpen((current) => !current)}
      >
        {TriggerIcon && <TriggerIcon className="h-4 w-4" />}
        <span>{label}</span>
        <ChevronDown className={cn('h-4 w-4 transition-transform', isOpen && 'rotate-180')} />
      </Button>

      {isOpen && (
        <div
          id={menuId}
          role="menu"
          className={cn(
            'absolute top-full z-50 mt-2 min-w-[220px] rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg',
            'animate-in fade-in-0 zoom-in-95',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <React.Fragment key={item.key}>
                {item.showDividerBefore && <div className="mx-2 my-1 h-px bg-border" />}
                <button
                  type="button"
                  role="menuitem"
                  disabled={item.disabled || item.loading}
                  onClick={() => runItem(item)}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors',
                    'focus:bg-accent focus:outline-none',
                    item.disabled || item.loading
                      ? 'cursor-not-allowed opacity-50'
                      : item.isDanger
                        ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950'
                        : 'hover:bg-accent',
                  )}
                >
                  {item.loading ? (
                    <Loader2 className="mt-0.5 h-4 w-4 flex-shrink-0 animate-spin" />
                  ) : (
                    Icon && <Icon className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium leading-5">{item.label}</span>
                    {item.description && (
                      <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">
                        {item.description}
                      </span>
                    )}
                  </span>
                </button>
              </React.Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}
