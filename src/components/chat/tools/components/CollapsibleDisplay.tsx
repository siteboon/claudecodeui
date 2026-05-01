import React, { useState, useRef, useEffect } from 'react';
import { Settings2 } from 'lucide-react';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '../../../../shared/view/ui';
import { CollapsibleSection } from './CollapsibleSection';
import { useToolDisplay } from '../../../../contexts/ToolDisplayContext';
import type { ToolDisplayDensity } from '../../../../hooks/useToolDisplayPreferences';

interface CollapsibleDisplayProps {
  toolName: string;
  toolId?: string;
  title: string;
  defaultOpen?: boolean;
  action?: React.ReactNode;
  badge?: React.ReactNode;
  onTitleClick?: () => void;
  children: React.ReactNode;
  showRawParameters?: boolean;
  rawContent?: string;
  className?: string;
  toolCategory?: string;
}

const borderColorMap: Record<string, string> = {
  edit: 'border-l-amber-500 dark:border-l-amber-400',
  search: 'border-l-muted-foreground/40',
  bash: 'border-l-green-500 dark:border-l-green-400',
  todo: 'border-l-violet-500 dark:border-l-violet-400',
  task: 'border-l-violet-500 dark:border-l-violet-400',
  agent: 'border-l-purple-500 dark:border-l-purple-400',
  plan: 'border-l-indigo-500 dark:border-l-indigo-400',
  question: 'border-l-blue-500 dark:border-l-blue-400',
  default: 'border-l-border',
};

const DENSITY_OPTIONS: { value: ToolDisplayDensity; label: string }[] = [
  { value: 'compact', label: 'Always compact' },
  { value: 'standard', label: 'Default' },
  { value: 'expanded', label: 'Always expanded' },
];

function DensityOverrideMenu({ toolName }: { toolName: string }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { preferences, setToolOverride, clearToolOverride } = useToolDisplay();
  const currentOverride = preferences.perToolOverrides[toolName]?.density;

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="rounded p-0.5 text-muted-foreground/40 opacity-0 transition-all hover:text-muted-foreground group-hover/tool:opacity-100"
        title="Tool display density"
      >
        <Settings2 className="h-3 w-3" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 min-w-[140px] rounded-md border border-border bg-popover p-1 shadow-md">
          {DENSITY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (opt.value === 'standard') clearToolOverride(toolName);
                else setToolOverride(toolName, { density: opt.value });
                setOpen(false);
              }}
              className={`flex w-full items-center gap-2 rounded-sm px-2 py-1 text-xs transition-colors hover:bg-accent ${
                (currentOverride === opt.value || (!currentOverride && opt.value === 'standard'))
                  ? 'font-medium text-primary'
                  : 'text-foreground'
              }`}
            >
              {(currentOverride === opt.value || (!currentOverride && opt.value === 'standard')) && (
                <svg className="h-3 w-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              )}
              {!(currentOverride === opt.value || (!currentOverride && opt.value === 'standard')) && (
                <span className="h-3 w-3 flex-shrink-0" />
              )}
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export const CollapsibleDisplay: React.FC<CollapsibleDisplayProps> = ({
  toolName,
  title,
  defaultOpen = false,
  action,
  badge,
  onTitleClick,
  children,
  showRawParameters = false,
  rawContent,
  className = '',
  toolCategory,
}) => {
  const borderColor = borderColorMap[toolCategory || 'default'] || borderColorMap.default;

  return (
    <div className={`group/tool border-l-2 ${borderColor} my-1 py-0.5 pl-3 ${className}`}>
      <CollapsibleSection
        title={title}
        toolName={toolName}
        open={defaultOpen}
        action={<>{action}<DensityOverrideMenu toolName={toolName} /></>}
        badge={badge}
        onTitleClick={onTitleClick}
      >
        {children}

        {showRawParameters && rawContent && (
          <Collapsible className="mt-2">
            <CollapsibleTrigger className="flex items-center gap-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground">
              <svg
                className="h-2.5 w-2.5 flex-shrink-0 transition-transform duration-150 data-[state=open]:rotate-90"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              raw params
            </CollapsibleTrigger>
            <CollapsibleContent>
              <pre className="mt-1 overflow-hidden whitespace-pre-wrap break-words rounded border border-border/40 bg-muted p-2 font-mono text-[11px] text-muted-foreground">
                {rawContent}
              </pre>
            </CollapsibleContent>
          </Collapsible>
        )}
      </CollapsibleSection>
    </div>
  );
};
