import { MessageSquare } from 'lucide-react';
import packageJson from '../../../../../package.json';

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
            <span className="text-base font-semibold text-foreground">Claude Code UI</span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              v{packageJson.version}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
