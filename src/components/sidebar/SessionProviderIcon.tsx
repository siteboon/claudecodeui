import type { SessionProvider } from '../../types/app';
import ClaudeLogo from '../ClaudeLogo';
import CodexLogo from '../CodexLogo';
import CursorLogo from '../CursorLogo';

type SessionProviderIconProps = {
  provider: SessionProvider;
  className: string;
};

export default function SessionProviderIcon({ provider, className }: SessionProviderIconProps) {
  if (provider === 'cursor') {
    return <CursorLogo className={className} />;
  }

  if (provider === 'codex') {
    return <CodexLogo className={className} />;
  }

  return <ClaudeLogo className={className} />;
}
