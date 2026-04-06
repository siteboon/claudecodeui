import { useCallback, useMemo, useState } from 'react';
import { FolderPlus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../../utils/api';
import ErrorBanner from './components/ErrorBanner';
import StepConfiguration from './components/StepConfiguration';
import StepRemoteConfiguration from './components/StepRemoteConfiguration';
import StepRemoteDirectoryPicker from './components/StepRemoteDirectoryPicker';
import StepReview from './components/StepReview';
import StepTypeSelection from './components/StepTypeSelection';
import WizardFooter from './components/WizardFooter';
import WizardProgress from './components/WizardProgress';
import { useGithubTokens } from './hooks/useGithubTokens';
import { cloneWorkspaceWithProgress, createWorkspaceRequest } from './data/workspaceApi';
import { isCloneWorkflow, shouldShowGithubAuthentication } from './utils/pathUtils';
import type { TokenMode, WizardFormState, WizardStep, WorkspaceType } from './types';

type ProjectCreationWizardProps = {
  onClose: () => void;
  onProjectCreated?: (project?: Record<string, unknown>) => void;
};

const initialFormState: WizardFormState = {
  workspaceType: 'existing',
  workspacePath: '',
  githubUrl: '',
  tokenMode: 'stored',
  selectedGithubToken: '',
  newGithubToken: '',
  remoteHostName: '',
  remoteHostname: '',
  remotePort: 22,
  remoteUsername: '',
  remotePrivateKeyPath: '',
  remoteHostId: '',
  remoteConnectionTested: false,
  remotePath: '',
};

const REMOTE_CONFIG_FIELDS = [
  'remoteHostName',
  'remoteHostname',
  'remotePort',
  'remoteUsername',
  'remotePrivateKeyPath',
] as const satisfies ReadonlyArray<keyof WizardFormState>;

export default function ProjectCreationWizard({
  onClose,
  onProjectCreated,
}: ProjectCreationWizardProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<WizardStep>(1);
  const [formState, setFormState] = useState<WizardFormState>(initialFormState);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cloneProgress, setCloneProgress] = useState('');
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);

  const shouldLoadTokens =
    step === 2 && shouldShowGithubAuthentication(formState.workspaceType, formState.githubUrl);

  const autoSelectToken = useCallback((tokenId: string) => {
    setFormState((previous) => ({ ...previous, selectedGithubToken: tokenId }));
  }, []);

  const {
    tokens: availableTokens,
    loading: loadingTokens,
    loadError: tokenLoadError,
    selectedTokenName,
  } = useGithubTokens({
    shouldLoad: shouldLoadTokens,
    selectedTokenId: formState.selectedGithubToken,
    onAutoSelectToken: autoSelectToken,
  });

  // Keep cross-step values in this component; local UI state lives in child components.
  const updateField = useCallback(<K extends keyof WizardFormState>(key: K, value: WizardFormState[K]) => {
    const isRemoteConfigField = REMOTE_CONFIG_FIELDS.includes(key as (typeof REMOTE_CONFIG_FIELDS)[number]);
    if (isRemoteConfigField) {
      setTestResult(null);
    }

    setFormState((previous) => {
      const next = { ...previous, [key]: value };

      if (isRemoteConfigField) {
        next.remoteConnectionTested = false;
        next.remoteHostId = '';
        next.remotePath = '';
      }

      return next;
    });
  }, []);

  const updateWorkspaceType = useCallback(
    (workspaceType: WorkspaceType) => updateField('workspaceType', workspaceType),
    [updateField],
  );

  const updateTokenMode = useCallback(
    (tokenMode: TokenMode) => updateField('tokenMode', tokenMode),
    [updateField],
  );

  const handleTestConnection = useCallback(async () => {
    setIsTesting(true);
    setTestResult(null);

    try {
      const response = await api.remoteHosts.test({
        name: formState.remoteHostName,
        hostname: formState.remoteHostname,
        port: formState.remotePort,
        username: formState.remoteUsername,
        privateKeyPath: formState.remotePrivateKeyPath,
      });

      const body = await response.json();

      if (response.ok && body.success) {
        setTestResult({ success: true });
        updateField('remoteConnectionTested', true);
      } else {
        setTestResult({ success: false, error: body.error || 'Connection failed' });
        updateField('remoteConnectionTested', false);
      }
    } catch {
      setTestResult({ success: false, error: 'Connection failed' });
      updateField('remoteConnectionTested', false);
    } finally {
      setIsTesting(false);
    }
  }, [formState.remoteHostName, formState.remoteHostname, formState.remotePort, formState.remoteUsername, formState.remotePrivateKeyPath, updateField]);

  const handleNext = useCallback(async () => {
    setError(null);

    if (step === 1) {
      if (!formState.workspaceType) {
        setError(t('projectWizard.errors.selectType'));
        return;
      }
      setStep(2);
      return;
    }

    if (step === 2) {
      if (formState.workspaceType === 'remote') {
        if (!formState.remoteConnectionTested) {
          setError(t('projectWizard.errors.testConnectionFirst'));
          return;
        }

        setIsCreating(true);
        try {
          let hostId = formState.remoteHostId;

          // Create host before navigating to step 3 when needed.
          if (!hostId) {
            const createRes = await api.remoteHosts.create({
              name: formState.remoteHostName,
              hostname: formState.remoteHostname,
              port: formState.remotePort,
              username: formState.remoteUsername,
              privateKeyPath: formState.remotePrivateKeyPath,
            });

            const createBody = await createRes.json();
            if (!createRes.ok) {
              setError(createBody.error || t('projectWizard.errors.failedToCreate'));
              return;
            }

            hostId = createBody.id;
            updateField('remoteHostId', hostId);
          }

          // Connect and wait for ready state.
          const connectRes = await api.remoteHosts.connect(hostId);
          const connectBody = await connectRes.json();
          if (!connectRes.ok) {
            setError(connectBody.error || t('projectWizard.errors.remoteConnectionNotReady'));
            return;
          }

          // Poll until connection is ready (daemon deployed + handshake complete).
          const maxAttempts = 30;
          let isConnectionReady = false;
          for (let i = 0; i < maxAttempts; i++) {
            await new Promise((r) => setTimeout(r, 1000));
            try {
              const statusRes = await api.remoteHosts.status(hostId);
              const statusBody = await statusRes.json();
              if (statusBody.state === 'ready') {
                isConnectionReady = true;
                break;
              }
              if (
                statusBody.state === 'error'
                || statusBody.state === 'disconnected'
                || statusBody.state === 'failed'
              ) {
                setError(statusBody.error || t('projectWizard.errors.remoteConnectionNotReady'));
                return;
              }
            } catch {
              // Retry on network error
            }
          }

          if (!isConnectionReady) {
            setError(t('projectWizard.errors.remoteConnectionNotReady'));
            return;
          }

          setStep(3);
        } catch {
          setError(t('projectWizard.errors.failedToCreate'));
        } finally {
          setIsCreating(false);
        }
        return;
      }

      if (!formState.workspacePath.trim()) {
        setError(t('projectWizard.errors.providePath'));
        return;
      }
      setStep(3);
    }
  }, [formState.workspacePath, formState.workspaceType, formState.remoteConnectionTested, formState.remoteHostId, formState.remoteHostName, formState.remoteHostname, formState.remotePort, formState.remoteUsername, formState.remotePrivateKeyPath, step, t, updateField]);

  const handleBack = useCallback(() => {
    setError(null);
    setStep((previousStep) => (previousStep > 1 ? ((previousStep - 1) as WizardStep) : previousStep));
  }, []);

  const handleCreate = useCallback(async () => {
    setIsCreating(true);
    setError(null);
    setCloneProgress('');

    try {
      // Remote workflow
      if (formState.workspaceType === 'remote') {
        if (!formState.remotePath.trim()) {
          setError(t('projectWizard.errors.selectRemoteDirectory'));
          setIsCreating(false);
          return;
        }

        const hostId = formState.remoteHostId;
        const addRes = await api.remoteHosts.addProject(hostId, formState.remotePath);
        const addBody = await addRes.json();

        if (!addRes.ok || !addBody.success) {
          throw new Error(addBody.error || t('projectWizard.errors.failedToAddRemoteProject'));
        }

        onProjectCreated?.(addBody.project);
        onClose();
        return;
      }

      const shouldCloneRepository = isCloneWorkflow(formState.workspaceType, formState.githubUrl);

      if (shouldCloneRepository) {
        const project = await cloneWorkspaceWithProgress(
          {
            workspacePath: formState.workspacePath,
            githubUrl: formState.githubUrl,
            tokenMode: formState.tokenMode,
            selectedGithubToken: formState.selectedGithubToken,
            newGithubToken: formState.newGithubToken,
          },
          {
            onProgress: setCloneProgress,
          },
        );

        onProjectCreated?.(project);
        onClose();
        return;
      }

      const project = await createWorkspaceRequest({
        workspaceType: formState.workspaceType,
        path: formState.workspacePath.trim(),
      });

      onProjectCreated?.(project);
      onClose();
    } catch (createError) {
      const errorMessage =
        createError instanceof Error
          ? createError.message
          : t('projectWizard.errors.failedToCreate');
      setError(errorMessage);
    } finally {
      setIsCreating(false);
    }
  }, [formState, onClose, onProjectCreated, t]);

  const shouldCloneRepository = useMemo(
    () => isCloneWorkflow(formState.workspaceType, formState.githubUrl),
    [formState.githubUrl, formState.workspaceType],
  );

  return (
    <div className="fixed bottom-0 left-0 right-0 top-0 z-[60] flex items-center justify-center bg-black/50 p-0 backdrop-blur-sm sm:p-4">
      <div className="h-full w-full overflow-y-auto rounded-none border-0 border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-800 sm:h-auto sm:max-w-2xl sm:rounded-lg sm:border">
        <div className="flex items-center justify-between border-b border-gray-200 p-6 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/50">
              <FolderPlus className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              {t('projectWizard.title')}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
            disabled={isCreating}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <WizardProgress step={step} />

        <div className="min-h-[300px] space-y-6 p-6">
          {error && <ErrorBanner message={error} />}

          {step === 1 && (
            <StepTypeSelection
              workspaceType={formState.workspaceType}
              onWorkspaceTypeChange={updateWorkspaceType}
            />
          )}

          {step === 2 && formState.workspaceType === 'remote' && (
            <StepRemoteConfiguration
              remoteHostName={formState.remoteHostName}
              onRemoteHostNameChange={(v) => updateField('remoteHostName', v)}
              remoteHostname={formState.remoteHostname}
              onRemoteHostnameChange={(v) => updateField('remoteHostname', v)}
              remotePort={formState.remotePort}
              onRemotePortChange={(v) => updateField('remotePort', v)}
              remoteUsername={formState.remoteUsername}
              onRemoteUsernameChange={(v) => updateField('remoteUsername', v)}
              remotePrivateKeyPath={formState.remotePrivateKeyPath}
              onRemotePrivateKeyPathChange={(v) => updateField('remotePrivateKeyPath', v)}
              remoteConnectionTested={formState.remoteConnectionTested}
              onTestConnection={handleTestConnection}
              isTesting={isTesting}
              testResult={testResult}
            />
          )}

          {step === 2 && formState.workspaceType !== 'remote' && (
            <StepConfiguration
              workspaceType={formState.workspaceType}
              workspacePath={formState.workspacePath}
              githubUrl={formState.githubUrl}
              tokenMode={formState.tokenMode}
              selectedGithubToken={formState.selectedGithubToken}
              newGithubToken={formState.newGithubToken}
              availableTokens={availableTokens}
              loadingTokens={loadingTokens}
              tokenLoadError={tokenLoadError}
              isCreating={isCreating}
              onWorkspacePathChange={(workspacePath) => updateField('workspacePath', workspacePath)}
              onGithubUrlChange={(githubUrl) => updateField('githubUrl', githubUrl)}
              onTokenModeChange={updateTokenMode}
              onSelectedGithubTokenChange={(selectedGithubToken) =>
                updateField('selectedGithubToken', selectedGithubToken)
              }
              onNewGithubTokenChange={(newGithubToken) =>
                updateField('newGithubToken', newGithubToken)
              }
              onAdvanceToConfirm={() => setStep(3)}
            />
          )}

          {step === 3 && formState.workspaceType === 'remote' && (
            <StepRemoteDirectoryPicker
              hostId={formState.remoteHostId}
              remotePath={formState.remotePath}
              onRemotePathChange={(path) => updateField('remotePath', path)}
              remoteHostName={formState.remoteHostName}
              remoteHostname={formState.remoteHostname}
            />
          )}

          {step === 3 && formState.workspaceType !== 'remote' && (
            <StepReview
              formState={formState}
              selectedTokenName={selectedTokenName}
              isCreating={isCreating}
              cloneProgress={cloneProgress}
            />
          )}
        </div>

        <WizardFooter
          step={step}
          isCreating={isCreating}
          isCloneWorkflow={shouldCloneRepository}
          onClose={onClose}
          onBack={handleBack}
          onNext={handleNext}
          onCreate={handleCreate}
        />
      </div>
    </div>
  );
}
