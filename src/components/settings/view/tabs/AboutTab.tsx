import { Cloud, ExternalLink, MessageSquare, Users } from 'lucide-react';

import { version as currentVersion } from '../../../../../package.json';
import { CLOUDCLI_WORDMARK_FONT_FAMILY } from '../../../../constants/branding';
import { IS_PLATFORM } from '../../../../constants/config';
import PremiumFeatureCard from '../PremiumFeatureCard';

const DOCS_URL = 'https://cloudcli.ai/docs/plugin-overview';
const CLOUDCLI_URL = 'https://cloudcli.ai';

export default function AboutTab() {
  return (
    <div className="space-y-6">
      {/* Logo + name + version */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary/90 shadow-sm">
          <MessageSquare className="h-5 w-5 text-primary-foreground" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span
              className="text-base font-semibold text-foreground"
              style={{ fontFamily: CLOUDCLI_WORDMARK_FONT_FAMILY }}
            >
              CloudCLI
            </span>
            <span
              className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              v{currentVersion}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Open-source AI coding assistant interface
          </p>
        </div>
      </div>

      {/* Links */}
      <div className="flex flex-wrap gap-4 text-sm">
        <a
          href={DOCS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Docs
        </a>
        <a
          href={CLOUDCLI_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          cloudcli.ai
        </a>
      </div>

      {/* Hosted CTA (OSS mode only) */}
      {!IS_PLATFORM && (
        <div className="rounded-xl border border-primary/10 bg-primary/5 p-4">
          <h4 className="text-sm font-medium text-foreground">Try CloudCLI Hosted</h4>
          <p className="mt-1 text-xs text-muted-foreground">
            Team collaboration, shared MCP configs, settings sync across environments, and managed infrastructure.
          </p>
          <a
            href={CLOUDCLI_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary transition-colors hover:underline"
          >
            Learn more
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      )}

      {/* Premium feature placeholders (OSS mode only) */}
      {!IS_PLATFORM && (
        <div className="space-y-4 border-t border-border/50 pt-6">
          <h3 className="text-sm font-medium text-foreground">CloudCLI Pro Features</h3>
          <PremiumFeatureCard
            icon={<Cloud className="h-5 w-5" />}
            title="Sync Settings"
            description="Keep your preferences, MCP configs, and theme in sync across all your environments."
          />
          <PremiumFeatureCard
            icon={<Users className="h-5 w-5" />}
            title="Team Management"
            description="Multiple users, role-based access, and shared projects for your team."
          />
        </div>
      )}

      {/* License */}
      <div className="border-t border-border/50 pt-4">
        <p className="text-xs text-muted-foreground/60">
          Licensed under AGPL-3.0
        </p>
      </div>
    </div>
  );
}
