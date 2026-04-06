import { CheckCircle, Loader2, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../../lib/utils';
import { Button, Input } from '../../../shared/view/ui';

type StepRemoteConfigurationProps = {
  remoteHostName: string;
  onRemoteHostNameChange: (value: string) => void;
  remoteHostname: string;
  onRemoteHostnameChange: (value: string) => void;
  remotePort: number;
  onRemotePortChange: (value: number) => void;
  remoteUsername: string;
  onRemoteUsernameChange: (value: string) => void;
  remotePrivateKeyPath: string;
  onRemotePrivateKeyPathChange: (value: string) => void;
  remoteConnectionTested: boolean;
  onTestConnection: () => void;
  isTesting: boolean;
  testResult: { success: boolean; error?: string } | null;
};

export default function StepRemoteConfiguration({
  remoteHostName,
  onRemoteHostNameChange,
  remoteHostname,
  onRemoteHostnameChange,
  remotePort,
  onRemotePortChange,
  remoteUsername,
  onRemoteUsernameChange,
  remotePrivateKeyPath,
  onRemotePrivateKeyPathChange,
  onTestConnection,
  isTesting,
  testResult,
}: StepRemoteConfigurationProps) {
  const { t } = useTranslation();

  const isTestDisabled =
    isTesting ||
    !remoteHostName.trim() ||
    !remoteHostname.trim() ||
    !remoteUsername.trim() ||
    !remotePrivateKeyPath.trim();

  return (
    <div className="space-y-4">
      <h4 className="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300">
        {t('projectWizard.step2.remote.title')}
      </h4>

      <div className="space-y-4">
        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('projectWizard.step2.remote.connectionName')}
          </label>
          <Input
            type="text"
            value={remoteHostName}
            onChange={(e) => onRemoteHostNameChange(e.target.value)}
            placeholder={t('projectWizard.step2.remote.connectionNamePlaceholder')}
            className="w-full"
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {t('projectWizard.step2.remote.connectionNameHelp')}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('projectWizard.step2.remote.hostname')}
            </label>
            <Input
              type="text"
              value={remoteHostname}
              onChange={(e) => onRemoteHostnameChange(e.target.value)}
              placeholder={t('projectWizard.step2.remote.hostnamePlaceholder')}
              className="w-full"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('projectWizard.step2.remote.port')}
            </label>
            <Input
              type="number"
              value={remotePort}
              onChange={(e) => onRemotePortChange(Math.max(1, Math.min(65535, Number(e.target.value) || 22)))}
              min={1}
              max={65535}
              className="w-full"
            />
          </div>
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('projectWizard.step2.remote.username')}
          </label>
          <Input
            type="text"
            value={remoteUsername}
            onChange={(e) => onRemoteUsernameChange(e.target.value)}
            placeholder={t('projectWizard.step2.remote.usernamePlaceholder')}
            className="w-full"
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('projectWizard.step2.remote.privateKeyPath')}
          </label>
          <Input
            type="text"
            value={remotePrivateKeyPath}
            onChange={(e) => onRemotePrivateKeyPathChange(e.target.value)}
            placeholder={t('projectWizard.step2.remote.privateKeyPathPlaceholder')}
            className="w-full"
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {t('projectWizard.step2.remote.privateKeyHelp')}
          </p>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <Button
            variant="outline"
            onClick={onTestConnection}
            disabled={isTestDisabled}
          >
            {isTesting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('projectWizard.step2.remote.testing')}
              </>
            ) : (
              t('projectWizard.step2.remote.testConnection')
            )}
          </Button>

          {testResult && (
            <div
              className={cn(
                'flex items-center gap-1.5 text-sm',
                testResult.success
                  ? 'text-green-600 dark:text-green-400'
                  : 'text-red-600 dark:text-red-400',
              )}
            >
              {testResult.success ? (
                <>
                  <CheckCircle className="h-4 w-4" />
                  {t('projectWizard.step2.remote.connectionSuccess')}
                </>
              ) : (
                <>
                  <XCircle className="h-4 w-4" />
                  {testResult.error || t('projectWizard.step2.remote.connectionFailed')}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
