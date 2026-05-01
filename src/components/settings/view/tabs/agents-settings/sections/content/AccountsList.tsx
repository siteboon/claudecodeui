import { Check, Trash2, Zap } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge, Button } from '../../../../../../../shared/view/ui';
import type { ProviderAccount } from '../../hooks/useProviderAccounts';

type AccountsListProps = {
  accounts: ProviderAccount[];
  loading: boolean;
  onActivate: (accountId: number) => Promise<void>;
  onRemove: (accountId: number) => Promise<void>;
  accentClass: string;
};

export default function AccountsList({ accounts, loading, onActivate, onRemove, accentClass }: AccountsListProps) {
  const { t } = useTranslation('settings');
  const [pendingAction, setPendingAction] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  if (loading && accounts.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('agents.accounts.loading')}</p>;
  }

  if (accounts.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('agents.accounts.empty')}</p>;
  }

  const handleActivate = async (id: number) => {
    setPendingAction(id);
    try {
      await onActivate(id);
    } finally {
      setPendingAction(null);
    }
  };

  const handleRemove = async (id: number) => {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      return;
    }
    setPendingAction(id);
    try {
      await onRemove(id);
    } finally {
      setPendingAction(null);
      setConfirmDeleteId(null);
    }
  };

  return (
    <div className="space-y-2">
      {accounts.map((account) => (
        <div
          key={account.id}
          className="flex items-center justify-between rounded-md border border-border/50 bg-background/50 px-3 py-2"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium text-foreground">
                {account.account_name}
              </span>
              {account.is_active === 1 && (
                <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                  <Check className="mr-1 h-3 w-3" />
                  {t('agents.accounts.active')}
                </Badge>
              )}
            </div>
            {account.email && (
              <p className="truncate text-xs text-muted-foreground">{account.email}</p>
            )}
            <p className="text-xs text-muted-foreground">
              {account.auth_method === 'api_key' ? t('agents.accounts.apiKey') : account.auth_method}
            </p>
          </div>
          <div className="flex items-center gap-1">
            {account.is_active !== 1 && (
              <Button
                variant="ghost"
                size="sm"
                disabled={pendingAction !== null}
                onClick={() => handleActivate(account.id)}
                className={accentClass}
              >
                <Zap className="mr-1 h-3 w-3" />
                {t('agents.accounts.activate')}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              disabled={pendingAction !== null}
              onClick={() => handleRemove(account.id)}
              className={confirmDeleteId === account.id
                ? 'text-red-600 hover:text-red-700 dark:text-red-400'
                : 'text-muted-foreground hover:text-foreground'}
            >
              <Trash2 className="h-3 w-3" />
              {confirmDeleteId === account.id && (
                <span className="ml-1">{t('agents.accounts.confirmDelete')}</span>
              )}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
