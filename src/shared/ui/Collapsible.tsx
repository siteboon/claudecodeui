import * as React from 'react';

import { cn } from '@/shared/utils';

type CollapsibleContextValue = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const CollapsibleContext = React.createContext<CollapsibleContextValue | null>(null);

export function useCollapsible() {
  const ctx = React.useContext(CollapsibleContext);
  if (!ctx) throw new Error('Collapsible components must be used within <Collapsible>');
  return ctx;
}

type CollapsibleProps = {
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
} & React.HTMLAttributes<HTMLDivElement>;

/** Used by the chat module for collapsible tool output and by the shared Reasoning primitive. */
export const Collapsible = React.forwardRef<HTMLDivElement, CollapsibleProps>(
  ({ defaultOpen = false, open: controlledOpen, onOpenChange: controlledOnOpenChange, className, children, ...props }, ref) => {
    const [internalOpen, setInternalOpen] = React.useState(defaultOpen);
    const isControlled = controlledOpen !== undefined;
    const open = isControlled ? controlledOpen : internalOpen;
    const onOpenChange = React.useCallback(
      (next: boolean) => {
        if (!isControlled) setInternalOpen(next);
        controlledOnOpenChange?.(next);
      },
      [isControlled, controlledOnOpenChange]
    );

    const value = React.useMemo(() => ({ open, onOpenChange }), [open, onOpenChange]);

    return (
      <CollapsibleContext.Provider value={value}>
        <div ref={ref} data-state={open ? 'open' : 'closed'} className={className} {...props}>
          {children}
        </div>
      </CollapsibleContext.Provider>
    );
  }
);
Collapsible.displayName = 'Collapsible';

/** Toggle slot of Collapsible, used by the chat module and the shared Reasoning primitive. */
export const CollapsibleTrigger = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ onClick, children, className, ...props }, ref) => {
    const { open, onOpenChange } = useCollapsible();

    const handleClick = React.useCallback(
      (e: React.MouseEvent<HTMLButtonElement>) => {
        onOpenChange(!open);
        onClick?.(e);
      },
      [open, onOpenChange, onClick]
    );

    return (
      <button
        ref={ref}
        type="button"
        aria-expanded={open}
        data-state={open ? 'open' : 'closed'}
        onClick={handleClick}
        className={className}
        {...props}
      >
        {children}
      </button>
    );
  }
);
CollapsibleTrigger.displayName = 'CollapsibleTrigger';

/** Body slot of Collapsible, used by the chat module and the shared Reasoning primitive. */
export const CollapsibleContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => {
    const { open } = useCollapsible();

    return (
      <div
        ref={ref}
        data-state={open ? 'open' : 'closed'}
        className={cn(
          'grid transition-[grid-template-rows] duration-200 ease-out',
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
          className
        )}
        {...props}
      >
        <div className="overflow-hidden">
          {children}
        </div>
      </div>
    );
  }
);
CollapsibleContent.displayName = 'CollapsibleContent';

