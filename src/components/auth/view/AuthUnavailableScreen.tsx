import { CLOUDCLI_WORDMARK_FONT_FAMILY } from '../../../shared/constants';

type AuthUnavailableScreenProps = {
  onRetry: () => void;
};

/**
 * Shown when the stored session could not be verified because the server was
 * unreachable. Deliberately not the login form: the token is still held, so
 * asking for credentials would discard a session the server never rejected.
 */
export default function AuthUnavailableScreen({ onRetry }: AuthUnavailableScreenProps) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background p-4">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 left-1/2 h-[36rem] w-[36rem] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
      </div>

      <div className="relative max-w-sm text-center" role="status" aria-live="polite">
        <div className="mb-5 flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/80 shadow-lg shadow-primary/25 ring-1 ring-inset ring-white/20">
            <img src="/logo.svg" alt="CloudCLI" className="h-9 w-9" />
          </div>
        </div>

        <h1
          className="mb-3 text-2xl font-bold tracking-tight text-foreground"
          style={{ fontFamily: CLOUDCLI_WORDMARK_FONT_FAMILY }}
        >
          CloudCLI
        </h1>

        <p className="mb-6 text-sm text-muted-foreground">
          Cannot reach the server. You are still signed in - this will reconnect on its own.
        </p>

        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
