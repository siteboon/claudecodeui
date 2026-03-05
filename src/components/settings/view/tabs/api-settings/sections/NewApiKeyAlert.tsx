import { Check, Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../../../../../shared/view/ui';
import type { CreatedApiKey } from '../types';

type NewApiKeyAlertProps = {
  apiKey: CreatedApiKey;
  copiedKey: string | null;
  onCopy: (text: string, id: string) => void;
  onDismiss: () => void;
};

export default function NewApiKeyAlert({
  apiKey,
  copiedKey,
  onCopy,
  onDismiss,
}: NewApiKeyAlertProps) {
  const { t } = useTranslation('settings');

  return (
    <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-4">
      <h4 className="mb-2 font-semibold text-yellow-500">{t('apiKeys.newKey.alertTitle')}</h4>
      <p className="mb-3 text-sm text-muted-foreground">{t('apiKeys.newKey.alertMessage')}</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 break-all rounded bg-background/50 px-3 py-2 font-mono text-sm">
          {apiKey.apiKey}
        </code>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onCopy(apiKey.apiKey, 'new')}
        >
          {copiedKey === 'new' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
      <Button size="sm" variant="ghost" className="mt-3" onClick={onDismiss}>
        {t('apiKeys.newKey.iveSavedIt')}
      </Button>
    </div>
  );
}
