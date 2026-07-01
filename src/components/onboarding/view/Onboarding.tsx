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
      <div className="relative h-screen overflow-y-auto bg-background">
        <div aria-hidden className="pointer-events-none fixed inset-0">
          <div className="absolute -top-40 left-1/2 h-[36rem] w-[36rem] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
          <div className="absolute -bottom-32 -left-24 h-[26rem] w-[26rem] rounded-full bg-primary/5 blur-3xl" />
          <div className="absolute inset-0 bg-[radial-gradient(hsl(var(--foreground)/0.04)_1px,transparent_1px)] [background-size:22px_22px] opacity-60" />
        </div>

        <div className="relative mx-auto flex min-h-full w-full max-w-2xl items-center justify-center p-4">
          <div className="w-full py-6">
          <OnboardingStepProgress currentStep={currentStep} />

          <div className="rounded-2xl border border-border/70 bg-card/90 p-6 shadow-[0_24px_60px_-20px_hsl(var(--foreground)/0.18)] ring-1 ring-foreground/5 backdrop-blur-xl">
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
                <div
                  role="alert"
                  className="mt-5 rounded-xl border border-destructive/30 bg-destructive/10 p-3.5"
                >
                  <p className="text-sm text-destructive">{errorMessage}</p>
                </div>
              )}

            <div className="mt-6 flex items-center justify-between border-t border-border pt-5">
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
                    className="flex items-center gap-2 rounded-xl bg-primary px-6 py-2.5 font-medium text-primary-foreground shadow-lg shadow-primary/25 transition-all duration-200 hover:brightness-110 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none"
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
                    className="flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-2.5 font-medium text-white shadow-lg shadow-emerald-600/25 transition-all duration-200 hover:bg-emerald-700 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none"
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
