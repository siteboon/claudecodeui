import { useTranslation } from 'react-i18next';
import { KeyRound } from 'lucide-react';

import { casLoginUrl } from '@/shared/api';

type CasSignInButtonProps = {
  label: string | null;
  isDisabled: boolean;
};

/**
 * Rendered by the auth module's LoginForm and SetupForm when the server has CAS
 * single sign-on enabled. A plain link: the server redirects to the CAS server,
 * which later sends the browser back to this same path.
 */
export default function CasSignInButton({ label, isDisabled }: CasSignInButtonProps) {
  const { t } = useTranslation('auth');
  const returnTo = `${window.location.pathname}${window.location.search}`;

  return (
    <div className="mt-5 space-y-5">
      <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-muted-foreground">
        <span aria-hidden className="h-px flex-1 bg-border" />
        {t('login.cas.divider')}
        <span aria-hidden className="h-px flex-1 bg-border" />
      </div>

      <a
        href={casLoginUrl(returnTo)}
        aria-disabled={isDisabled}
        className={`flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 py-2.5 text-center font-medium text-foreground transition-colors duration-200 hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/40 focus:ring-offset-2 focus:ring-offset-card ${isDisabled ? 'pointer-events-none opacity-60' : ''}`}
      >
        <KeyRound className="h-4 w-4 flex-shrink-0" />
        <span className="min-w-0 break-words">{label ?? t('login.cas.button')}</span>
      </a>
    </div>
  );
}
