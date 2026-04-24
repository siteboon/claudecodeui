import { Tooltip } from '../../../../shared/view/ui';

export type ModePill<T extends string = string> = {
  id: T;
  label: string;
  title?: string;
  dotColor?: string;
};

type ModePillsProps<T extends string> = {
  items: ModePill<T>[];
  selected: T;
  onSelect: (id: T) => void;
  ariaLabel: string;
  className?: string;
};

export default function ModePills<T extends string>({
  items,
  selected,
  onSelect,
  ariaLabel,
  className = '',
}: ModePillsProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={`flex items-center gap-1 rounded-full border border-border/60 bg-background/40 p-0.5 ${className}`}
    >
      {items.map((item) => {
        const active = item.id === selected;
        const pill = (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onSelect(item.id)}
            className={`flex h-6 items-center gap-1.5 rounded-full px-2 text-[10px] uppercase tracking-wider transition-colors ${
              active
                ? 'bg-foreground/10 text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {item.dotColor && (
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: item.dotColor }}
              />
            )}
            <span>{item.label}</span>
          </button>
        );

        if (item.title) {
          return (
            <Tooltip key={item.id} content={item.title} position="top">
              {pill}
            </Tooltip>
          );
        }
        return pill;
      })}
    </div>
  );
}
