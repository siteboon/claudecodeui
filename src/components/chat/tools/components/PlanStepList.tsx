import { CheckCircle, Circle, Loader2 } from 'lucide-react';
import { useState } from 'react';

import type { PlanStep } from '../utils/planStepParser';

interface PlanStepListProps {
  steps: PlanStep[];
}

const STATUS_ICON = {
  pending: <Circle className="h-4 w-4 text-muted-foreground" />,
  in_progress: <Loader2 className="h-4 w-4 animate-spin text-blue-500" />,
  completed: <CheckCircle className="h-4 w-4 text-green-500" />,
} as const;

export default function PlanStepList({ steps }: PlanStepListProps) {
  const completedCount = steps.filter((s) => s.status === 'completed').length;

  if (steps.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic">
        No structured steps detected in this plan.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      {/* Progress bar */}
      <div className="mb-3 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-green-500 transition-all duration-500"
            style={{ width: `${(completedCount / steps.length) * 100}%` }}
          />
        </div>
        <span className="text-xs text-muted-foreground">
          {completedCount}/{steps.length}
        </span>
      </div>

      {/* Steps */}
      {steps.map((step) => (
        <PlanStepItem key={step.id} step={step} />
      ))}
    </div>
  );
}

function PlanStepItem({ step }: { step: PlanStep }) {
  const [open, setOpen] = useState(step.status === 'in_progress');
  const hasSubsteps = step.substeps && step.substeps.length > 0;

  return (
    <div className="rounded border border-border/40 bg-background/50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50"
      >
        {STATUS_ICON[step.status]}
        <span
          className={`flex-1 font-medium ${
            step.status === 'completed'
              ? 'text-muted-foreground line-through'
              : 'text-foreground'
          }`}
        >
          {step.title}
        </span>
        {hasSubsteps && (
          <span className="text-xs text-muted-foreground">
            {step.substeps!.filter((s) => s.status === 'completed').length}/
            {step.substeps!.length}
          </span>
        )}
      </button>

      {open && (
        <div className="border-t border-border/30 px-3 py-2">
          {step.description && (
            <p className="mb-2 text-xs text-muted-foreground">
              {step.description}
            </p>
          )}
          {hasSubsteps && (
            <div className="space-y-1 pl-2">
              {step.substeps!.map((sub) => (
                <div key={sub.id} className="flex items-center gap-2 text-xs">
                  {STATUS_ICON[sub.status]}
                  <span
                    className={
                      sub.status === 'completed'
                        ? 'text-muted-foreground line-through'
                        : 'text-foreground'
                    }
                  >
                    {sub.title}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
