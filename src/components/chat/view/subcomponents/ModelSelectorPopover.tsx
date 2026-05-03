import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { PROVIDERS } from '../../../../../shared/modelConstants';
import type { LLMProvider } from '../../../../types/app';
import ClaudeSparkle from '../../../icons/ClaudeSparkle';

export interface ProviderConfig {
  id: string;
  label: string;
  models: string[];
}

interface ModelSelectorButtonProps {
  currentProvider: LLMProvider;
  currentModelLabel: string;
  currentModel: string;
  onSelect: (provider: LLMProvider, model: string) => void;
}

const MODEL_BADGES: Record<string, string[]> = {
  'claude-opus-4-20250514': ['Vision', 'Thinking'],
  'claude-sonnet-4-20250514': ['Vision', 'Thinking'],
  'claude-3-5-sonnet-20241022': ['Vision'],
  'claude-3-5-haiku-20241022': ['Fast'],
  'o4-mini': ['Thinking'],
  'gpt-4.1': ['Vision'],
  'gemini-2.5-pro': ['Vision', 'Thinking'],
  'gemini-2.5-flash': ['Fast', 'Vision'],
};

function getBadges(modelValue: string): string[] {
  for (const [key, badges] of Object.entries(MODEL_BADGES)) {
    if (modelValue.includes(key)) return badges;
  }
  return [];
}

function ProviderIcon({ provider, className }: { provider: string; className?: string }) {
  if (provider === 'claude' || provider === 'openclaude') {
    return <ClaudeSparkle className={className} />;
  }
  return (
    <span className={`inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm bg-muted text-[8px] font-bold uppercase leading-none ${className ?? ''}`}>
      {provider.slice(0, 2)}
    </span>
  );
}

export default function ModelSelectorButton({
  currentProvider,
  currentModelLabel,
  currentModel,
  onSelect,
}: ModelSelectorButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState(currentProvider);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [isOpen]);

  useEffect(() => {
    setActiveTab(currentProvider);
  }, [currentProvider]);

  const activeProviderConfig = PROVIDERS.find((p) => p.id === activeTab);

  return (
    <div className="relative" ref={popoverRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <ProviderIcon provider={currentProvider} />
        <span>{currentModelLabel}</span>
        <ChevronDown className="h-3 w-3" />
      </button>

      {isOpen && (
        <div
          data-testid="model-selector-popover"
          className="absolute bottom-full left-0 z-50 mb-2 min-w-[280px] rounded-xl border border-border bg-popover p-1 shadow-lg"
        >
          <div className="mb-1 flex gap-0.5 overflow-x-auto rounded-lg bg-muted p-0.5">
            {PROVIDERS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setActiveTab(p.id as LLMProvider)}
                className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                  activeTab === p.id
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>

          <div className="max-h-[240px] overflow-y-auto space-y-0.5">
            {activeProviderConfig?.models.OPTIONS.map((model: { value: string; label: string }) => {
              const isSelected = activeTab === currentProvider && model.value === currentModel;
              return (
                <button
                  key={model.value}
                  type="button"
                  data-testid={`model-item-${model.value}`}
                  onClick={() => {
                    onSelect(activeTab, model.value);
                    setIsOpen(false);
                  }}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left transition-colors ${
                    isSelected ? 'bg-primary/10 text-foreground' : 'hover:bg-accent'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{model.label}</span>
                    {getBadges(model.value).map((badge) => (
                      <span key={badge} className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                        {badge}
                      </span>
                    ))}
                  </div>
                  {isSelected && <Check data-testid="model-check" className="h-4 w-4 text-primary" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
