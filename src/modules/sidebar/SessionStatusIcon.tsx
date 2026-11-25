import { Loader2 } from 'lucide-react';
import type { TFunction } from 'i18next';

import { LLMProviderLogo } from '@/shared/ui';
import { cn } from '@/shared/utils';
import type { LLMProvider } from '@/shared/types';

type SessionStatusIconProps = {
  provider: LLMProvider;
  needsAttention: boolean;
  isProcessing: boolean;
  hasBackgroundWork: boolean;
  t: TFunction;
};

const SLOT_CLASS = 'flex h-5 w-4 flex-shrink-0 items-center justify-center';

function StatusDot({ colorClass, label }: { colorClass: string; label: string }) {
  return (
    <span className={SLOT_CLASS}>
      <span role="status" aria-label={label} title={label} className={cn('h-2 w-2 rounded-full', colorClass)} />
    </span>
  );
}

/**
 * The leading icon of a session row, shared by the Projects and Conversations
 * rows: amber when the session needs the user, a spinner while a response is in
 * flight, purple while only its background work runs (nothing is responding, so
 * nothing spins), otherwise the provider's logo.
 */
export default function SessionStatusIcon({ provider, needsAttention, isProcessing, hasBackgroundWork, t }: SessionStatusIconProps) {
  if (needsAttention) {
    return <StatusDot colorClass="bg-amber-500" label={t('tooltips.attentionRequiredIndicator', 'Session needs attention')} />;
  }

  if (isProcessing) {
    const label = t('tooltips.processingSessionIndicator', 'Processing session');
    return (
      <span className={SLOT_CLASS} title={label}>
        <Loader2 role="img" aria-label={label} className="h-3.5 w-3.5 text-primary motion-safe:animate-spin" />
      </span>
    );
  }

  if (hasBackgroundWork) {
    return <StatusDot colorClass="bg-purple-500 dark:bg-purple-400" label={t('tooltips.backgroundWorkIndicator', 'Background work running')} />;
  }

  return (
    <span className={cn(SLOT_CLASS, 'opacity-60 grayscale')}>
      <LLMProviderLogo provider={provider} className="h-3.5 w-3.5" />
    </span>
  );
}
