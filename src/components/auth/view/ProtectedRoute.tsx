import type { ReactNode } from 'react';

import { IS_PLATFORM } from '../../../shared/utils';
import { useAuth } from '../context/AuthContext';
import Onboarding from '../../onboarding/view/Onboarding';
import { resolveAuthView } from '../utils';
import AuthLoadingScreen from './AuthLoadingScreen';
import AuthUnavailableScreen from './AuthUnavailableScreen';
import LoginForm from './LoginForm';
import SetupForm from './SetupForm';

type ProtectedRouteProps = {
  children: ReactNode;
};

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
      // A view the resolver gains later must fail to compile here rather than
      // fall through to the app: rendering the whole UI is the one outcome
      // that must never be reached by accident.
      const unhandled: never = view;
      throw new Error(`Unhandled auth view: ${String(unhandled)}`);
    }
  }
}
