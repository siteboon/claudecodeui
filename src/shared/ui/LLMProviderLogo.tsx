import { PluginIcon } from '@/modules/plugins';
import { getPluginProvider } from '@/shared/providerRegistry';
import type { LLMProvider } from '@/shared/types';
import ClaudeLogo from '@/shared/ui/ClaudeLogo';
import CodexLogo from '@/shared/ui/CodexLogo';
import CursorLogo from '@/shared/ui/CursorLogo';
import OpenCodeLogo from '@/shared/ui/OpenCodeLogo';

type LLMProviderLogoProps = {
  provider?: LLMProvider | string | null;
  className?: string;
};

/** Used by the chat, onboarding, project-workspace, settings and sidebar modules to show which coding agent a session or project belongs to. */
export function LLMProviderLogo({
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

  const pluginProvider = getPluginProvider(provider);
  if (pluginProvider?.pluginIcon) {
    return (
      <PluginIcon
        pluginName={pluginProvider.pluginName}
        iconFile={pluginProvider.pluginIcon}
        className={`inline-flex [&>svg]:h-full [&>svg]:w-full ${className}`}
      />
    );
  }

  return <ClaudeLogo className={className} />;
}
