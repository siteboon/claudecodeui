import { Star, X } from 'lucide-react';
import { useGitHubStars } from '../../../../hooks/useGitHubStars';
import { IS_PLATFORM } from '../../../../constants/config';

const GITHUB_REPO_URL = 'https://github.com/siteboon/claudecodeui';

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
    </svg>
  );
}

export default function GitHubStarBadge() {
  const { formattedCount, isDismissed, dismiss } = useGitHubStars('siteboon', 'claudecodeui');

  if (IS_PLATFORM || isDismissed) return null;

  return (
    <div className="group/star relative hidden md:block">
      <a
        href={GITHUB_REPO_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 rounded-lg border border-border/50 bg-muted/30 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
      >
        <GitHubIcon className="h-3.5 w-3.5" />
        <Star className="h-3 w-3" />
        <span className="font-medium">Star</span>
        {formattedCount && (
          <span className="border-l border-border/50 pl-1.5 tabular-nums">{formattedCount}</span>
        )}
      </a>
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          dismiss();
        }}
        className="absolute -right-1.5 -top-1.5 hidden h-4 w-4 items-center justify-center rounded-full border border-border/50 bg-muted text-muted-foreground transition-colors hover:text-foreground group-hover/star:flex"
        aria-label="Dismiss"
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </div>
  );
}
