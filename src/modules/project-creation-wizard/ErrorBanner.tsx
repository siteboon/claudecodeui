import { AlertCircle } from 'lucide-react';

import { Button } from '@/shared/ui';

type ErrorBannerProps = {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
};

/** Rendered by ProjectCreationWizard to surface the wizard's current error message and an optional recovery action. */
export default function ErrorBanner({ message, actionLabel, onAction }: ErrorBannerProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600 dark:text-red-400" />
        <p className="text-sm text-red-800 dark:text-red-200">{message}</p>
      </div>
      {actionLabel && onAction && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onAction}
          className="shrink-0 border-red-300 bg-white text-red-700 hover:bg-red-100 dark:border-red-700 dark:bg-red-950 dark:text-red-200 dark:hover:bg-red-900/50"
        >
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
