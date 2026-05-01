import { Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { Button, Input } from '../../../../../../../shared/view/ui';

type AddAccountDialogProps = {
  providerName: string;
  onAdd: (accountName: string, credentialValue: string, email?: string) => Promise<void>;
  buttonClass: string;
};

export default function AddAccountDialog({ providerName, onAdd, buttonClass }: AddAccountDialogProps) {
  const { t } = useTranslation('settings');
  const [open, setOpen] = useState(false);
  const [accountName, setAccountName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const resetForm = () => {
    setAccountName('');
    setApiKey('');
    setEmail('');
    setError(null);
  };

  const handleClose = () => {
    setOpen(false);
    resetForm();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountName.trim() || !apiKey.trim()) return;

    setSubmitting(true);
    setError(null);
    try {
      await onAdd(accountName.trim(), apiKey.trim(), email.trim() || undefined);
      handleClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to add account');
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => nameInputRef.current?.focus());
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); handleClose(); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open]);

  return (
    <>
      <Button
        size="sm"
        className={`${buttonClass} text-white`}
        onClick={() => setOpen(true)}
      >
        <Plus className="mr-1 h-4 w-4" />
        {t('agents.accounts.addButton')}
      </Button>

      {open && createPortal(
        <div className="fixed inset-0 z-[10000]">
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm"
            onClick={handleClose}
            aria-hidden
          />
          <div
            role="dialog"
            aria-modal="true"
            className="fixed left-1/2 top-1/2 z-[10001] w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-popover text-popover-foreground shadow-lg"
          >
            <form onSubmit={handleSubmit}>
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <h3 className="text-sm font-semibold text-foreground">
                  {t('agents.accounts.addTitle', { provider: providerName })}
                </h3>
                <button type="button" onClick={handleClose} className="text-muted-foreground hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-3 px-4 py-4">
                <div>
                  <label className="mb-1 block text-xs font-medium text-foreground">
                    {t('agents.accounts.nameLabel')}
                  </label>
                  <Input
                    ref={nameInputRef}
                    value={accountName}
                    onChange={(e) => setAccountName(e.target.value)}
                    placeholder={t('agents.accounts.namePlaceholder')}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-foreground">
                    {t('agents.accounts.apiKeyLabel')}
                  </label>
                  <Input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={t('agents.accounts.apiKeyPlaceholder')}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-foreground">
                    {t('agents.accounts.emailLabel')}
                  </label>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t('agents.accounts.emailPlaceholder')}
                  />
                </div>

                {error && (
                  <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                )}
              </div>

              <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
                <Button type="button" variant="ghost" size="sm" onClick={handleClose}>
                  {t('agents.accounts.cancelButton')}
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  className={`${buttonClass} text-white`}
                  disabled={submitting || !accountName.trim() || !apiKey.trim()}
                >
                  {submitting ? t('agents.accounts.adding') : t('agents.accounts.addButton')}
                </Button>
              </div>
            </form>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
