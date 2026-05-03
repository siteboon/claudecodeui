import ClaudeSparkle from '../../../icons/ClaudeSparkle';

const SUGGESTIONS = [
  { title: 'Write code', description: 'for a REST API endpoint' },
  { title: 'Debug an issue', description: 'in my application' },
  { title: 'Explain a concept', description: 'in simple terms' },
  { title: 'Help me plan', description: 'a new project' },
];

interface EmptyStateProps {
  onSuggestionClick: (prompt: string) => void;
}

export default function EmptyState({ onSuggestionClick }: EmptyStateProps) {
  return (
    <div className="mx-auto flex h-full max-w-lg flex-col items-center justify-center px-6">
      <ClaudeSparkle data-testid="claude-sparkle" className="h-12 w-12 text-primary" />
      <h1 className="mb-8 mt-6 text-2xl font-semibold text-foreground">
        How can I help you today?
      </h1>
      <div className="grid w-full grid-cols-2 gap-3">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.title}
            onClick={() => onSuggestionClick(`${s.title} ${s.description}`)}
            className="rounded-xl border border-border/50 bg-secondary/50 px-4 py-3 text-left transition-colors hover:bg-secondary"
          >
            <div className="text-sm font-medium text-foreground">{s.title}</div>
            <div className="text-xs text-muted-foreground">{s.description}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
