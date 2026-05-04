import ClaudeSparkle from '../../../icons/ClaudeSparkle';

const SUGGESTIONS = [
  { title: 'Write code', description: 'for a REST API endpoint' },
  { title: 'Debug an issue', description: 'in my application' },
  { title: 'Explain a concept', description: 'in simple terms' },
  { title: 'Help me plan', description: 'a new project' },
];

export function getTimeOfDayGreeting(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 18) return 'Good afternoon';
  return 'Good evening';
}

interface EmptyStateProps {
  onSuggestionClick: (prompt: string) => void;
}

export default function EmptyState({ onSuggestionClick }: EmptyStateProps) {
  const greeting = getTimeOfDayGreeting(new Date().getHours());

  return (
    <div className="relative mx-auto flex h-full max-w-lg flex-col items-center justify-center px-6">
      {/* E3: gradient background */}
      <div
        data-testid="empty-state-gradient"
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
      >
        <div className="absolute left-1/2 top-1/3 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute left-1/3 top-2/3 h-48 w-48 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/3 blur-2xl" />
      </div>

      <ClaudeSparkle data-testid="claude-sparkle" className="h-12 w-12 text-primary" />

      {/* E4: time-of-day greeting */}
      <h1 className="mb-8 mt-6 text-2xl font-semibold text-foreground">
        {greeting}
      </h1>

      {/* E2: suggestion chips */}
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
