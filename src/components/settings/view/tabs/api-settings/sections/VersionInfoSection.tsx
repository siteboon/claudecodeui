import { MessageSquare } from 'lucide-react';
import packageJson from '../../../../../../../package.json';

// Lightweight "about" block reused by API settings. The local build no longer
// pulls release info from GitHub; we just surface the static app version.
export default function VersionInfoSection() {
  return (
    <div className="border-t border-border/50 pt-6">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-primary/90 shadow-sm">
            <MessageSquare className="h-4.5 w-4.5 text-primary-foreground" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground">Claude Code UI</span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                v{packageJson.version}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
