import { useTranslation } from 'react-i18next';
import { Blocks } from 'lucide-react';

interface ArtifactToggleProps {
  count: number;
  isOpen: boolean;
  onToggle: () => void;
}

export default function ArtifactToggle({ count, isOpen, onToggle }: ArtifactToggleProps) {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      data-active={isOpen}
      onClick={onToggle}
      aria-label={t('artifacts.toggle')}
      className={`relative rounded p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground ${isOpen ? 'bg-secondary text-foreground' : ''}`}
    >
      <Blocks className="h-4 w-4" />
      {count > 0 && (
        <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
          {count}
        </span>
      )}
    </button>
  );
}
