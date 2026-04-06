import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, CheckCircle, Folder, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../../lib/utils';
import { api } from '../../../utils/api';
import { Button, Input } from '../../../shared/view/ui';

type DirectoryEntry = {
  name: string;
  path: string;
  type: string;
};

type StepRemoteDirectoryPickerProps = {
  hostId: string;
  remotePath: string;
  onRemotePathChange: (path: string) => void;
  remoteHostName: string;
  remoteHostname: string;
};

export default function StepRemoteDirectoryPicker({
  hostId,
  remotePath,
  onRemotePathChange,
  remoteHostName,
  remoteHostname,
}: StepRemoteDirectoryPickerProps) {
  const { t } = useTranslation();
  const [currentBrowsePath, setCurrentBrowsePath] = useState(remotePath || '/home');
  const [pathInput, setPathInput] = useState(remotePath || '/home');
  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const fetchSeqRef = useRef(0);

  const fetchEntries = useCallback(async (browsePath: string) => {
    if (!hostId) return;
    const seq = ++fetchSeqRef.current;
    setIsLoading(true);
    setBrowseError(null);

    try {
      const response = await api.remoteHosts.browse(hostId, browsePath);
      if (seq !== fetchSeqRef.current) return;
      if (!response.ok) {
        const data = await response.json();
        setBrowseError(data.error || t('projectWizard.errors.failedToBrowseRemote'));
        setEntries([]);
        return;
      }

      const data = await response.json();
      if (seq !== fetchSeqRef.current) return;
      setEntries(data.entries || []);
      setCurrentBrowsePath(data.path || browsePath);
      setPathInput(data.path || browsePath);
    } catch {
      if (seq !== fetchSeqRef.current) return;
      setBrowseError(t('projectWizard.errors.failedToBrowseRemote'));
      setEntries([]);
    } finally {
      if (seq === fetchSeqRef.current) {
        setIsLoading(false);
      }
    }
  }, [hostId, t]);

  // Reset browse state when host changes
  useEffect(() => {
    const defaultPath = remotePath || '/home';
    setCurrentBrowsePath(defaultPath);
    setPathInput(defaultPath);
    setEntries([]);
    setBrowseError(null);
    fetchEntries(defaultPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostId]);

  const handleNavigate = useCallback((dirPath: string) => {
    setPathInput(dirPath);
    fetchEntries(dirPath);
  }, [fetchEntries]);

  const handleGoUp = useCallback(() => {
    if (currentBrowsePath === '/') return;
    const parentPath = currentBrowsePath.replace(/\/[^/]+\/?$/, '') || '/';
    handleNavigate(parentPath);
  }, [currentBrowsePath, handleNavigate]);

  const handlePathInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleNavigate(pathInput);
    }
  }, [handleNavigate, pathInput]);

  const handleSelectDirectory = useCallback(() => {
    onRemotePathChange(currentBrowsePath);
  }, [currentBrowsePath, onRemotePathChange]);

  const isAtRoot = currentBrowsePath === '/';
  const isSelected = remotePath === currentBrowsePath && remotePath !== '';
  const canSelectDirectory = !isLoading && !browseError;

  return (
    <div className="space-y-4">
      <h4 className="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300">
        {t('projectWizard.step3.remote.title')}
      </h4>

      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/50">
        <div className="flex items-center gap-4 text-sm">
          <div>
            <span className="text-gray-500 dark:text-gray-400">
              {t('projectWizard.step3.remote.connectionName')}:
            </span>{' '}
            <span className="font-medium text-gray-900 dark:text-white">{remoteHostName}</span>
          </div>
          <div>
            <span className="text-gray-500 dark:text-gray-400">
              {t('projectWizard.step3.remote.remoteHost')}:
            </span>{' '}
            <span className="font-medium text-gray-900 dark:text-white">{remoteHostname}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          onClick={handleGoUp}
          disabled={isAtRoot || isLoading}
          className="h-9 w-9 flex-shrink-0"
        >
          <ArrowUp className="h-4 w-4" />
        </Button>
        <Input
          type="text"
          value={pathInput}
          onChange={(e) => setPathInput(e.target.value)}
          onKeyDown={handlePathInputKeyDown}
          className="w-full font-mono text-sm"
        />
      </div>

      <div className="max-h-[240px] overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
          </div>
        ) : browseError ? (
          <div className="px-4 py-8 text-center text-sm text-red-600 dark:text-red-400">
            {browseError}
          </div>
        ) : entries.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            {t('projectWizard.step3.remote.selectDirectory')}
          </div>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-700/50">
            {entries.map((entry) => (
              <li key={entry.path}>
                <button
                  onClick={() => handleNavigate(entry.path)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50"
                >
                  <Folder className="h-4 w-4 flex-shrink-0 text-blue-500 dark:text-blue-400" />
                  <span className="truncate text-gray-900 dark:text-gray-100">{entry.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center justify-between gap-3">
        <div
          className={cn(
            'flex-1 rounded-lg border px-3 py-2 text-sm font-mono',
            remotePath
              ? 'border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300'
              : 'border-gray-200 bg-gray-50 text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400',
          )}
        >
          {remotePath || t('projectWizard.step3.remote.noDirectorySelected')}
        </div>

        <Button
          variant={isSelected ? 'secondary' : 'outline'}
          onClick={handleSelectDirectory}
          disabled={!canSelectDirectory}
          className="flex-shrink-0"
        >
          {isSelected ? (
            <>
              <CheckCircle className="mr-1.5 h-4 w-4" />
              {t('common.select')}
            </>
          ) : (
            t('common.select')
          )}
        </Button>
      </div>
    </div>
  );
}
