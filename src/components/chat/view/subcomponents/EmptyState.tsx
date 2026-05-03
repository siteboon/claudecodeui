const SUGGESTIONS = [
  { title: 'Write code', description: 'for a REST API endpoint' },
  { title: 'Debug an issue', description: 'in my application' },
  { title: 'Explain a concept', description: 'in simple terms' },
  { title: 'Help me plan', description: 'a new project' },
];

function ClaudeSparkle({ size = 48 }: { size?: number }) {
  return (
    <svg data-testid="claude-sparkle" width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M12 2L14.5 9.5L22 12L14.5 14.5L12 22L9.5 14.5L2 12L9.5 9.5L12 2Z"
        fill="hsl(var(--primary))"
      />
    </svg>
  );
}

interface EmptyStateProps {
  onSuggestionClick: (prompt: string) => void;
}

export default function EmptyState({ onSuggestionClick }: EmptyStateProps) {
  return (
    <div className="mx-auto -mt-16 flex h-full max-w-lg flex-col items-center justify-center px-6">
      <ClaudeSparkle size={48} />
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
