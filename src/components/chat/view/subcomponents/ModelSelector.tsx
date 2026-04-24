import {
  CLAUDE_MODELS,
  getClaudeContextWindow,
} from '../../../../../shared/modelConstants';
import { Tooltip } from '../../../../shared/view/ui';

type ModelSelectorProps = {
  claudeModel: string;
  setClaudeModel: (model: string) => void;
  tokensUsed: number;
};

function formatK(n: number) {
  if (n >= 1_000_000) return `${n / 1_000_000}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return `${n}`;
}

export default function ModelSelector({
  claudeModel,
  setClaudeModel,
  tokensUsed,
}: ModelSelectorProps) {
  const handleSelect = (value: string) => {
    if (value === claudeModel) return;

    const nextWindow = getClaudeContextWindow(value);
    const nextLabel = CLAUDE_MODELS.OPTIONS.find((o) => o.value === value)?.label || value;
    if (tokensUsed > nextWindow) {
      const ok = window.confirm(
        `You've used ${formatK(tokensUsed)} tokens, which exceeds ${nextLabel}'s ` +
          `${formatK(nextWindow)} context window.\n\n` +
          `Switching now will likely cause a context-overflow error on the next turn. Continue anyway?`,
      );
      if (!ok) return;
    }

    setClaudeModel(value);
    localStorage.setItem('claude-model', value);
  };

  return (
    <div
      role="radiogroup"
      aria-label="Claude model"
      className="flex items-center gap-1 rounded-full border border-border/60 bg-background/40 p-0.5"
    >
      {CLAUDE_MODELS.OPTIONS.map((opt) => {
        const active = opt.value === claudeModel;
        const win = getClaudeContextWindow(opt.value);
        const pill = (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => handleSelect(opt.value)}
            className={`flex h-6 items-center rounded-full px-2 text-[10px] tracking-wider transition-colors ${
              active
                ? 'bg-foreground/10 text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {opt.label}
          </button>
        );

        return (
          <Tooltip key={opt.value} content={`${opt.label} · ${formatK(win)} context`} position="top">
            {pill}
          </Tooltip>
        );
      })}
    </div>
  );
}
