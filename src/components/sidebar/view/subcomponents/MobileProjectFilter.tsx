import type { ProjectRailItemData } from '../../../project-rail/types/types';

type MobileProjectFilterProps = {
  items: ProjectRailItemData[];
  activeFilter: string | null;
  onFilter: (projectName: string | null) => void;
};

export default function MobileProjectFilter({
  items,
  activeFilter,
  onFilter,
}: MobileProjectFilterProps) {
  return (
    <div className="scrollbar-hide flex gap-1.5 overflow-x-auto border-b border-border/60 px-3 py-2">
      <button
        onClick={() => onFilter(null)}
        className={`flex-shrink-0 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
          activeFilter === null
            ? 'bg-eucalyptus text-eucalyptus-foreground'
            : 'bg-muted text-muted-foreground'
        }`}
      >
        All
      </button>
      {items.map((item) => (
        <button
          key={item.name}
          onClick={() => onFilter(item.name)}
          className={`relative flex-shrink-0 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
            activeFilter === item.name
              ? 'bg-eucalyptus text-eucalyptus-foreground'
              : 'bg-muted text-muted-foreground'
          }`}
        >
          {item.abbreviation}
          {item.attentionCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-attention" />
          )}
        </button>
      ))}
    </div>
  );
}
