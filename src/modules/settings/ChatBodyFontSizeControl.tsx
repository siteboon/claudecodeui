import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

import { normalizeChatBodyFontSize } from '@/shared/utils';

type ChatBodyFontSizeControlProps = {
  value: number;
  onChange: (value: number) => void;
  label: string;
};

const MIN_DROPDOWN_FONT_SIZE = 12;
const MAX_DROPDOWN_FONT_SIZE = 20;

const FONT_SIZE_OPTIONS = Array.from(
  { length: MAX_DROPDOWN_FONT_SIZE - MIN_DROPDOWN_FONT_SIZE + 1 },
  (_, index) => MIN_DROPDOWN_FONT_SIZE + index,
);

/** Used by AppearanceSettingsTab to edit and preview the transcript reading size. */
export default function ChatBodyFontSizeControl({
  value,
  onChange,
  label,
}: ChatBodyFontSizeControlProps) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  // Keeps partially typed numeric input separate from the last committed setting.
  const [draft, setDraft] = useState(String(value));
  // Controls whether the bounded list of supported pixel sizes is visible.
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [isOpen]);

  const commit = (nextValue: unknown = draft) => {
    const normalized = normalizeChatBodyFontSize(nextValue);
    setDraft(String(normalized));
    onChange(normalized);
  };

  return (
    <div ref={rootRef} className="relative w-32">
      <div className="flex h-10 items-center overflow-hidden rounded-lg border border-input bg-card focus-within:border-primary focus-within:ring-1 focus-within:ring-primary">
        <input
          type="text"
          inputMode="numeric"
          role="combobox"
          aria-label={label}
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          value={draft}
          onChange={(event) => {
            const nextDraft = event.target.value;
            if (/^\d*$/.test(nextDraft)) {
              setDraft(nextDraft);
            }
          }}
          onBlur={() => commit()}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setIsOpen(true);
            } else if (event.key === 'Enter') {
              event.preventDefault();
              commit();
              setIsOpen(false);
              event.currentTarget.blur();
            } else if (event.key === 'Escape') {
              setDraft(String(value));
              setIsOpen(false);
            }
          }}
          className="min-w-0 flex-1 bg-transparent py-2 pl-3 text-right text-sm tabular-nums text-foreground outline-none"
        />
        <span className="px-2 text-sm text-muted-foreground">px</span>
        <button
          type="button"
          onClick={() => setIsOpen((current) => !current)}
          aria-label={label}
          aria-expanded={isOpen}
          aria-controls={listboxId}
          className="flex h-full w-9 shrink-0 items-center justify-center border-l border-border text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {isOpen && (
        <div
          id={listboxId}
          role="listbox"
          aria-label={label}
          className="absolute right-0 z-30 mt-1 max-h-52 w-full overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-lg"
        >
          {FONT_SIZE_OPTIONS.map((fontSize) => (
            <button
              key={fontSize}
              type="button"
              role="option"
              aria-selected={fontSize === value}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                commit(fontSize);
                setIsOpen(false);
              }}
              className={`flex w-full items-center justify-between rounded px-2.5 py-1.5 text-left text-sm tabular-nums ${
                fontSize === value
                  ? 'bg-accent font-medium text-accent-foreground'
                  : 'text-popover-foreground hover:bg-accent/70'
              }`}
            >
              <span>{fontSize}</span>
              <span className="text-xs text-muted-foreground">px</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
