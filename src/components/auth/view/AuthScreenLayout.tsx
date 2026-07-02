import type { ReactNode } from 'react';

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
    <div className="relative h-screen overflow-y-auto bg-background">
      {/* Ambient, on-brand backdrop that gives the screen depth without
          competing with the card content. Fixed so it stays put while the
          form scrolls on short viewports. */}
      <div aria-hidden className="pointer-events-none fixed inset-0">
        <div className="absolute -top-40 left-1/2 h-[36rem] w-[36rem] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -bottom-32 -left-24 h-[26rem] w-[26rem] rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(hsl(var(--foreground)/0.04)_1px,transparent_1px)] opacity-60 [background-size:22px_22px]" />
      </div>

      <div className="relative mx-auto flex min-h-full w-full max-w-md items-center justify-center p-4 py-8">
        <div className="w-full rounded-2xl border border-border/70 bg-card/90 p-8 shadow-[0_24px_60px_-20px_hsl(var(--foreground)/0.18)] ring-1 ring-foreground/5 backdrop-blur-xl sm:p-10">
          <div className="text-center">
            <div className="mb-5 flex justify-center">
              {logo ?? (
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/80 shadow-lg shadow-primary/25 ring-1 ring-inset ring-white/20">
                  <img src="/logo.svg" alt="CloudCLI" className="h-9 w-9" />
                </div>
              )}
            </div>
            <h1 className="font-serif text-3xl font-bold tracking-tight text-foreground">{title}</h1>
            <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">{description}</p>
          </div>

          <div className="mt-8">{children}</div>

          <div className="mt-6 border-t border-border/60 pt-5 text-center">
            <p className="text-xs leading-relaxed text-muted-foreground">{footerText}</p>
          </div>

        </div>
      </div>
    </div>
  );
}
