import { useState, useRef, useEffect, useCallback, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, X } from 'lucide-react';
import { CLAUDE_MODELS, CURSOR_MODELS, CODEX_MODELS, GEMINI_MODELS } from '../../../../../shared/modelConstants';

type ModelSelectorProps = {
  provider: string;
  currentModel: string;
  onModelChange: (model: string) => void;
};

function getOptionsForProvider(provider: string) {
  if (provider === 'cursor') return CURSOR_MODELS.OPTIONS;
  if (provider === 'codex') return CODEX_MODELS.OPTIONS;
  if (provider === 'gemini') return GEMINI_MODELS.OPTIONS;
  return CLAUDE_MODELS.OPTIONS;
}

export default function ModelSelector({ provider, currentModel, onModelChange }: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties | null>(null);

  const options = getOptionsForProvider(provider);
  const currentLabel = options.find((m) => m.value === currentModel)?.label ?? currentModel;

  const closeDropdown = useCallback(() => setIsOpen(false), []);

  const updateDropdownPosition = useCallback(() => {
    const trigger = triggerRef.current;
    const dropdown = dropdownRef.current;
    if (!trigger || !dropdown || typeof window === 'undefined') return;

    const triggerRect = trigger.getBoundingClientRect();
    const viewportPadding = window.innerWidth < 640 ? 12 : 16;
    const spacing = 8;
    const width = Math.min(window.innerWidth - viewportPadding * 2, window.innerWidth < 640 ? 300 : 220);
    let left = triggerRect.left + triggerRect.width / 2 - width / 2;
    left = Math.max(viewportPadding, Math.min(left, window.innerWidth - width - viewportPadding));

    const measuredHeight = dropdown.offsetHeight || 0;
    const spaceBelow = window.innerHeight - triggerRect.bottom - spacing - viewportPadding;
    const spaceAbove = triggerRect.top - spacing - viewportPadding;
    const openBelow = spaceBelow >= Math.min(measuredHeight || 320, 320) || spaceBelow >= spaceAbove;
    const availableHeight = Math.min(
      window.innerHeight - viewportPadding * 2,
      Math.max(180, openBelow ? spaceBelow : spaceAbove),
    );
    const panelHeight = Math.min(measuredHeight || availableHeight, availableHeight);
    const top = openBelow
      ? Math.min(triggerRect.bottom + spacing, window.innerHeight - viewportPadding - panelHeight)
      : Math.max(viewportPadding, triggerRect.top - spacing - panelHeight);

    setDropdownStyle({ position: 'fixed', top, left, width, maxHeight: availableHeight, zIndex: 80 });
  }, []);

  useEffect(() => {
    if (!isOpen) { setDropdownStyle(null); return; }
    const rafId = window.requestAnimationFrame(updateDropdownPosition);
    window.addEventListener('resize', updateDropdownPosition);
    window.addEventListener('scroll', updateDropdownPosition, true);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', updateDropdownPosition);
      window.removeEventListener('scroll', updateDropdownPosition, true);
    };
  }, [isOpen, updateDropdownPosition]);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (e: PointerEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      if (containerRef.current?.contains(t) || dropdownRef.current?.contains(t)) return;
      closeDropdown();
    };
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') closeDropdown(); };
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, closeDropdown]);

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="flex h-7 items-center gap-1 rounded-md border border-border/60 bg-muted/50 px-2 text-xs font-medium text-muted-foreground transition-all duration-150 hover:bg-muted hover:text-foreground"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span className="whitespace-nowrap">{currentLabel}</span>
        <ChevronDown className="h-3 w-3 shrink-0 opacity-50" />
      </button>

      {isOpen && typeof document !== 'undefined' && createPortal(
        <div
          ref={dropdownRef}
          style={dropdownStyle || { position: 'fixed', top: 0, left: 0, visibility: 'hidden' }}
          className="flex flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-xl"
          role="listbox"
        >
          <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
            <h3 className="text-xs font-semibold text-foreground">Select model</h3>
            <button
              type="button"
              onClick={closeDropdown}
              className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="min-h-0 overflow-y-auto py-1">
            {options.map((option) => {
              const isSelected = option.value === currentModel;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onModelChange(option.value);
                    closeDropdown();
                  }}
                  className={`w-full px-3 py-2 text-left text-sm transition-colors hover:bg-accent ${
                    isSelected ? 'bg-accent/60 font-medium text-foreground' : 'text-muted-foreground'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span>{option.label}</span>
                    {isSelected && (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
