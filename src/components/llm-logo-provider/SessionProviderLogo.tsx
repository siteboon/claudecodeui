import type { LLMProvider } from '../../types/app';

import ClaudeLogo from './ClaudeLogo';
import CodexLogo from './CodexLogo';

type SessionProviderLogoProps = {
  provider?: LLMProvider | string | null;
  className?: string;
};

export default function SessionProviderLogo({
  provider = 'claude',
  className = 'w-5 h-5',
}: SessionProviderLogoProps) {
  if (provider === 'codex') {
    return <CodexLogo className={className} />;
  }

  return <ClaudeLogo className={className} />;
}
