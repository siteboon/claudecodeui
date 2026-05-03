import { useState } from 'react';
import { Check } from 'lucide-react';

export interface ProviderConfig {
  id: string;
  label: string;
  models: string[];
}

interface ModelSelectorPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  providers: ProviderConfig[];
  selectedProvider: string;
  selectedModel: string;
  onSelect: (provider: string, model: string) => void;
}

export default function ModelSelectorPopover({
  isOpen,
  onClose,
  providers,
  selectedProvider,
  selectedModel,
  onSelect,
}: ModelSelectorPopoverProps) {
  const [activeTab, setActiveTab] = useState(selectedProvider);

  if (!isOpen) return null;

  const activeProvider = providers.find((p) => p.id === activeTab) ?? providers[0];

  return (
    <div
      data-testid="model-selector-popover"
      className="min-w-[280px] rounded-xl border border-border bg-popover p-1 shadow-lg"
    >
      {providers.length > 1 && (
        <div className="mb-2 flex gap-1 rounded-lg bg-muted p-1">
          {providers.map((p) => (
            <button
              key={p.id}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === p.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setActiveTab(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-0.5">
        {activeProvider?.models.map((model) => {
          const isSelected = model === selectedModel && activeTab === selectedProvider;
          return (
            <button
              key={model}
              data-testid={`model-item-${model}`}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm transition-colors hover:bg-accent ${
                isSelected ? 'bg-accent/50' : ''
              }`}
              onClick={() => {
                onSelect(activeTab, model);
                onClose();
              }}
            >
              <span className="font-medium">{model}</span>
              {isSelected && <Check data-testid="model-check" size={16} className="text-primary" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
