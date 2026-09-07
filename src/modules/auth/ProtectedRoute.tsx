import type { ReactNode } from 'react';

import { IS_PLATFORM } from '@/shared/utils';
import { useAuth } from '@/modules/auth/context/AuthContext';
import { Onboarding } from '@/modules/onboarding';
import AuthLoadingScreen from '@/modules/auth/AuthLoadingScreen';
import AuthUnavailableScreen from '@/modules/auth/AuthUnavailableScreen';
import LoginForm from '@/modules/auth/LoginForm';
import SetupForm from '@/modules/auth/SetupForm';

type ProtectedRouteProps = {
  children: ReactNode;
};

export type AuthView = 'loading' | 'setup' | 'unavailable' | 'login' | 'onboarding' | 'app';

export type AuthViewState = {
  isLoading: boolean;
  isPlatform: boolean;
  needsSetup: boolean;
  hasToken: boolean;
  hasUser: boolean;
  authUnavailable: boolean;
  hasCompletedOnboarding: boolean;
};

export function resolveAuthView(state: AuthViewState): AuthView {
  if (state.isLoading) {
    return 'loading';
  }
  if (state.isPlatform) {
    return state.hasCompletedOnboarding ? 'app' : 'onboarding';
  }
  if (state.needsSetup) {
    return 'setup';
  }
  if (!state.hasUser) {
    return state.hasToken && state.authUnavailable ? 'unavailable' : 'login';
  }
  return state.hasCompletedOnboarding ? 'app' : 'onboarding';
}

/** Used by App to gate the routed application behind setup, login and onboarding. */
export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const {
    user,
    token,
    isLoading,
    needsSetup,
    hasCompletedOnboarding,
    refreshOnboardingStatus,
    authUnavailable,
    retryAuthCheck,
  } = useAuth();

  const view = resolveAuthView({
    isLoading,
    isPlatform: IS_PLATFORM,
    needsSetup,
    hasToken: Boolean(token),
    hasUser: Boolean(user),
    authUnavailable,
    hasCompletedOnboarding,
  });

  switch (view) {
    case 'loading':
      return <AuthLoadingScreen />;
    case 'setup':
      return <SetupForm />;
    case 'unavailable':
      return <AuthUnavailableScreen onRetry={retryAuthCheck} />;
    case 'login':
      return <LoginForm />;
    case 'onboarding':
      return <Onboarding onComplete={refreshOnboardingStatus} />;
    case 'app':
      return <>{children}</>;
    default: {
      const unhandled: never = view;
      throw new Error(`Unhandled auth view: ${String(unhandled)}`);
    }
  }
}
