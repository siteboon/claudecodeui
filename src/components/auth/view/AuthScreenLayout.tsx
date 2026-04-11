import type { ReactNode } from 'react';
import { MessageSquare } from 'lucide-react';
import { IS_PLATFORM } from '../../../constants/config';

type AuthScreenLayoutProps = {
  title: string;
  description: string;
  children: ReactNode;
  footerText: string;
  logo?: ReactNode;
};

export default function AuthScreenLayout({
  title,
  description,
  children,
  footerText,
  logo,
}: AuthScreenLayoutProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="space-y-6 rounded-lg border border-border bg-card p-8 shadow-lg">
          <div className="text-center">
            <div className="mb-4 flex justify-center">
              {logo ?? (
                <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-primary shadow-sm">
                  <MessageSquare className="h-8 w-8 text-primary-foreground" />
                </div>
              )}
            </div>
            <h1 className="text-2xl font-bold text-foreground">{title}</h1>
            <p className="mt-2 text-muted-foreground">{description}</p>
          </div>

          {children}

          <div className="text-center">
            <p className="text-sm text-muted-foreground">{footerText}</p>
          </div>

          {!IS_PLATFORM && (
            <div className="flex items-center justify-center gap-1.5 pt-2">
              <svg className="h-3.5 w-3.5 text-muted-foreground/50" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
              </svg>
              <a
                href="https://github.com/siteboon/claudecodeui"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-muted-foreground/50 transition-colors hover:text-muted-foreground"
              >
                CloudCLI is open source
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
