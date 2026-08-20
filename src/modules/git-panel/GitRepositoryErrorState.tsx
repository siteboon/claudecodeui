import { GitBranch, Loader2 } from 'lucide-react';

type GitRepositoryErrorStateProps = {
  error: string;
  details?: string;
  /** When true, the project directory has no repository and `git init` can fix it. */
  canInitRepository?: boolean;
  isInitializingRepository?: boolean;
  /** Failure from the last `git init` attempt, shown below the action. */
  initError?: string | null;
  onInitRepository?: () => void;
};

export default function GitRepositoryErrorState({
  error,
  details,
  canInitRepository = false,
  isInitializingRepository = false,
  initError,
  onInitRepository,
}: GitRepositoryErrorStateProps) {
  const showInitAction = canInitRepository && Boolean(onInitRepository);

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-muted-foreground">
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-muted/50">
        <GitBranch className="h-8 w-8 opacity-40" />
      </div>
      {showInitAction ? (
        <>
          <h3 className="mb-3 text-center text-lg font-medium text-foreground">No git repository</h3>
          <p className="mb-6 max-w-md text-center text-sm leading-relaxed">
            This project is not a git repository yet. Initialize one to start tracking changes and use source control features.
          </p>
          <button
            onClick={onInitRepository}
            disabled={isInitializingRepository}
            className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isInitializingRepository ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Initializing repository...
              </>
            ) : (
              <>
                <GitBranch className="h-4 w-4" />
                Run git init
              </>
            )}
          </button>
          {initError && (
            <p className="mt-4 max-w-md text-center text-sm leading-relaxed text-destructive">
              {initError}
            </p>
          )}
        </>
      ) : (
        <>
          <h3 className="mb-3 text-center text-lg font-medium text-foreground">{error}</h3>
          {details && (
            <p className="max-w-md text-center text-sm leading-relaxed">{details}</p>
          )}
        </>
      )}
    </div>
  );
}
