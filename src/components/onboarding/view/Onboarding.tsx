import { Check, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LLMProvider } from '../../../types/app';
import { authenticatedFetch } from '../../../utils/api';
import { useProviderAuthStatus } from '../../provider-auth/hooks/useProviderAuthStatus';
import ProviderLoginModal from '../../provider-auth/view/ProviderLoginModal';
import AgentConnectionsStep from './subcomponents/AgentConnectionsStep';
import GitConfigurationStep from './subcomponents/GitConfigurationStep';
import OnboardingStepProgress from './subcomponents/OnboardingStepProgress';
import {
  gitEmailPattern,
  readErrorMessageFromResponse,
} from './utils';

type OnboardingProps = {
  onComplete?: () => void | Promise<void>;
};

export default function Onboarding({ onComplete }: OnboardingProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [gitName, setGitName] = useState('');
  const [gitEmail, setGitEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [activeLoginProvider, setActiveLoginProvider] = useState<LLMProvider | null>(null);
  const {
    providerAuthStatus,
    checkProviderAuthStatus,
    refreshProviderAuthStatuses,
  } = useProviderAuthStatus();

  const previousActiveLoginProviderRef = useRef<LLMProvider | null | undefined>(undefined);

  const loadGitConfig = useCallback(async () => {
    try {
      const response = await authenticatedFetch('/api/user/git-config');
      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as { gitName?: string; gitEmail?: string };
      if (payload.gitName) {
        setGitName(payload.gitName);
      }
      if (payload.gitEmail) {
        setGitEmail(payload.gitEmail);
      }
    } catch (caughtError) {
      console.error('Error loading git config:', caughtError);
    }
  }, []);

  useEffect(() => {
    void loadGitConfig();
    void refreshProviderAuthStatuses();
  }, [loadGitConfig, refreshProviderAuthStatuses]);

  useEffect(() => {
    const previousProvider = previousActiveLoginProviderRef.current;
    previousActiveLoginProviderRef.current = activeLoginProvider;

    const didCloseModal = previousProvider !== undefined
      && previousProvider !== null
      && activeLoginProvider === null;

    // Refresh statuses after the login modal is closed.
    if (didCloseModal) {
      void refreshProviderAuthStatuses();
    }
  }, [activeLoginProvider, refreshProviderAuthStatuses]);

  const handleProviderLoginOpen = (provider: LLMProvider) => {
    setActiveLoginProvider(provider);
  };

  const handleLoginComplete = (exitCode: number) => {
    if (exitCode === 0 && activeLoginProvider) {
      void checkProviderAuthStatus(activeLoginProvider);
    }
  };

  const handleNextStep = async () => {
    setErrorMessage('');

    if (currentStep !== 0) {
      setCurrentStep((previous) => previous + 1);
      return;
    }

    if (!gitName.trim() || !gitEmail.trim()) {
      setErrorMessage('Both git name and email are required.');
      return;
    }

    if (!gitEmailPattern.test(gitEmail)) {
      setErrorMessage('Please enter a valid email address.');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await authenticatedFetch('/api/user/git-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gitName, gitEmail }),
      });

      if (!response.ok) {
        const message = await readErrorMessageFromResponse(response, 'Failed to save git configuration');
        throw new Error(message);
      }

      setCurrentStep((previous) => previous + 1);
    } catch (caughtError) {
      setErrorMessage(caughtError instanceof Error ? caughtError.message : 'Failed to save git configuration');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePreviousStep = () => {
    setErrorMessage('');
    setCurrentStep((previous) => previous - 1);
  };

  const handleFinish = async () => {
    setIsSubmitting(true);
    setErrorMessage('');

    try {
      const response = await authenticatedFetch('/api/user/complete-onboarding', { method: 'POST' });
      if (!response.ok) {
        const message = await readErrorMessageFromResponse(response, 'Failed to complete onboarding');
        throw new Error(message);
      }

      await onComplete?.();
    } catch (caughtError) {
      setErrorMessage(caughtError instanceof Error ? caughtError.message : 'Failed to complete onboarding');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isCurrentStepValid = currentStep === 0
    ? Boolean(gitName.trim() && gitEmail.trim() && gitEmailPattern.test(gitEmail))
    : true;

  return (
    <>
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-2xl">
          <OnboardingStepProgress currentStep={currentStep} />

          <div className="rounded-lg border border-border bg-card p-8 shadow-lg">
            {currentStep === 0 ? (
              <GitConfigurationStep
                gitName={gitName}
                gitEmail={gitEmail}
                isSubmitting={isSubmitting}
                onGitNameChange={setGitName}
                onGitEmailChange={setGitEmail}
              />
            ) : (
              <AgentConnectionsStep
                providerStatuses={providerAuthStatus}
                onOpenProviderLogin={handleProviderLoginOpen}
              />
            )}

            {errorMessage && (
              <div className="mt-6 rounded-lg border border-red-300 bg-red-100 p-4 dark:border-red-800 dark:bg-red-900/20">
                <p className="text-sm text-red-700 dark:text-red-400">{errorMessage}</p>
              </div>
            )}

            <div className="mt-8 flex items-center justify-between border-t border-border pt-6">
              <button
                onClick={handlePreviousStep}
                disabled={currentStep === 0 || isSubmitting}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-muted-foreground transition-colors duration-200 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </button>

              <div className="flex items-center gap-3">
                {currentStep < 1 ? (
                  <button
                    onClick={handleNextStep}
                    disabled={!isCurrentStepValid || isSubmitting}
                    className="flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-3 font-medium text-white transition-colors duration-200 hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        Next
                        <ChevronRight className="h-4 w-4" />
                      </>
                    )}
                  </button>
                ) : (
                  <button
                    onClick={handleFinish}
                    disabled={isSubmitting}
                    className="flex items-center gap-2 rounded-lg bg-green-600 px-6 py-3 font-medium text-white transition-colors duration-200 hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-green-400"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Completing...
                      </>
                    ) : (
                      <>
                        <Check className="h-4 w-4" />
                        Complete Setup
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {activeLoginProvider && (
        <ProviderLoginModal
          isOpen={Boolean(activeLoginProvider)}
          onClose={() => setActiveLoginProvider(null)}
          provider={activeLoginProvider}
          onComplete={handleLoginComplete}
        />
      )}
    </>
  );
}
