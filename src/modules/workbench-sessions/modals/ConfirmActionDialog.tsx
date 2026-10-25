import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, Dialog, DialogContent, DialogTitle } from '@/shared/ui';

type ConfirmActionDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** What will happen, including anything that gets deleted. */
  children: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  isBusy?: boolean;
  error?: string | null;
  onConfirm: () => void;
};

/** Rendered by WorkbenchSessionView to confirm squash-merge and discard, the two actions that change the base branch or delete work. */
export default function ConfirmActionDialog({
  open,
  onOpenChange,
  title,
  children,
  confirmLabel,
  destructive = false,
  isBusy = false,
  error = null,
  onConfirm,
}: ConfirmActionDialogProps) {
  const { t } = useTranslation('workbench');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-md p-5" aria-describedby="workbench-confirm-description">
        <DialogTitle className="not-sr-only text-base font-semibold text-foreground">{title}</DialogTitle>
        <div id="workbench-confirm-description" className="mt-3 space-y-2 text-sm text-muted-foreground">
          {children}
        </div>
        {error && (
          <p role="alert" className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={isBusy} className="min-h-11 md:min-h-0">
            {t('common.cancel')}
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            size="sm"
            onClick={onConfirm}
            disabled={isBusy}
           className="min-h-11 md:min-h-0">
            {isBusy ? t('common.working') : confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
