import type { ReactNode } from 'react';
import { MessageSquare } from 'lucide-react';

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
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-card rounded-lg shadow-lg border border-border p-8 space-y-6">
          <div className="text-center">
            <div className="flex justify-center mb-4">
              {logo ?? (
                <div className="w-16 h-16 bg-primary rounded-lg flex items-center justify-center shadow-sm">
                  <MessageSquare className="w-8 h-8 text-primary-foreground" />
                </div>
              )}
            </div>
            <h1 className="text-2xl font-bold text-foreground">{title}</h1>
            <p className="text-muted-foreground mt-2">{description}</p>
          </div>

          {children}

          <div className="text-center">
            <p className="text-sm text-muted-foreground">{footerText}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
