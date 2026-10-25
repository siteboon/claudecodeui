import { useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button, Dialog, DialogContent, DialogTitle } from '@/shared/ui';
import UsageView from '@/modules/usage/UsageView';

/** Rendered by the sidebar module below the Workbench sessions section: a button that opens the token usage view in a large dialog. */
export default function UsageEntry() {
  const { t } = useTranslation('usage');
  // Whether the usage dialog is open; the view only mounts while open, so logs are scanned on demand.
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="border-b border-border/50 px-2 py-1.5">
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        title={t('entry.title')}
        className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 py-1.5 md:min-h-0 text-left text-xs text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
      >
        <BarChart3 className="h-3.5 w-3.5 flex-shrink-0" />
        {t('entry.label')}
      </button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-h-[92vh] w-full max-w-5xl overflow-y-auto p-5" aria-describedby="usage-description">
          <DialogTitle className="sr-only">{t('title')}</DialogTitle>
          <span id="usage-description" className="sr-only">{t('description')}</span>
          {isOpen && <UsageView />}
          <div className="mt-4 flex justify-end">
            <Button variant="ghost" size="sm" onClick={() => setIsOpen(false)} className="min-h-11 md:min-h-0">{t('close')}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
