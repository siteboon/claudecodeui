import { Plus } from 'lucide-react';
import type { TFunction } from 'i18next';
import { cn } from '../../../../lib/utils';

type NewSessionRowProps = {
  onClick: () => void;
  t: TFunction;
  className?: string;
};

export default function NewSessionRow({ onClick, t, className }: NewSessionRowProps) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={cn(
        'mx-1 mt-1 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded-lg border border-dashed border-green-300/40 bg-green-50/40 px-3 py-2 text-left text-sm font-medium text-green-700 transition-all',
        'hover:border-green-400 hover:border-solid hover:bg-green-50/80',
        'dark:border-green-900/40 dark:bg-green-900/10 dark:text-green-400 dark:hover:border-green-800 dark:hover:bg-green-900/20',
        className,
      )}
    >
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-green-600 text-white dark:bg-green-700">
        <Plus className="h-3 w-3" strokeWidth={3} />
      </span>
      <span>{t('projects.newSession', { defaultValue: 'New session' })}</span>
    </button>
  );
}
