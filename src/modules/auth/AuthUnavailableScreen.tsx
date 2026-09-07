import AuthScreenLayout from '@/modules/auth/AuthScreenLayout';

type AuthUnavailableScreenProps = {
  onRetry: () => void;
};

export default function AuthUnavailableScreen({ onRetry }: AuthUnavailableScreenProps) {
  return (
    <AuthScreenLayout
      title="CloudCLI"
      description="Cannot reach the server. You are still signed in, and CloudCLI will reconnect on its own."
      footerText="Your stored session has been kept."
    >
      <div role="status" aria-live="polite">
        <button
          type="button"
          onClick={onRetry}
          className="flex w-full items-center justify-center rounded-xl bg-primary px-4 py-2.5 font-medium text-primary-foreground shadow-lg shadow-primary/25 transition-all duration-200 hover:shadow-primary/30 hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:ring-offset-2 focus:ring-offset-card active:scale-[0.99]"
        >
          Try again
        </button>
      </div>
    </AuthScreenLayout>
  );
}
