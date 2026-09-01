import type { LLMProvider } from '../../types/app';
import AntigravityLogo from './AntigravityLogo';
import ClaudeLogo from './ClaudeLogo';
import CodexLogo from './CodexLogo';
import CursorLogo from './CursorLogo';
import OpenCodeLogo from './OpenCodeLogo';
import ZCodeLogo from './ZCodeLogo';

type LLMProviderLogoProps = {
  provider?: LLMProvider | string | null;
  className?: string;
};

export default function LLMProviderLogo({
  provider = 'claude',
  className = 'w-5 h-5',
}: LLMProviderLogoProps) {
  if (provider === 'cursor') {
    return <CursorLogo className={className} />;
  }

  if (provider === 'codex') {
    return <CodexLogo className={className} />;
  }

  if (provider === 'opencode') {
    return <OpenCodeLogo className={className} />;
  }

  if (provider === 'zcode') {
    return <ZCodeLogo className={className} />;
  }

  if (provider === 'antigravity') {
    return <AntigravityLogo className={className} />;
  }

  return <ClaudeLogo className={className} />;
}
