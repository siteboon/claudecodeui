/**
 * Parse plan markdown content into structured steps.
 */

export interface PlanStep {
  id: string;
  title: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'completed';
  substeps?: PlanStep[];
}

/**
 * Parse plan markdown into structured steps.
 *
 * Detects:
 * - Numbered headings: `## 1. Title` or `## Step 1: Title`
 * - Numbered lists: `1. Title`
 * - Checkbox items: `- [ ] Title` / `- [x] Title`
 */
export function parsePlanSteps(markdown: string): PlanStep[] {
  const lines = markdown.split('\n');
  const steps: PlanStep[] = [];
  let currentStep: PlanStep | null = null;
  let descLines: string[] = [];

  const flushDescription = () => {
    if (currentStep && descLines.length > 0) {
      currentStep.description = descLines.join('\n').trim();
      descLines = [];
    }
  };

  for (const line of lines) {
    // Heading-based steps: ## Step 1: Title or ## 1. Title
    const headingMatch = line.match(
      /^#{1,3}\s+(?:Step\s+)?(\d+)[.:]\s*(.+)/i,
    );
    if (headingMatch) {
      flushDescription();
      currentStep = {
        id: `step-${headingMatch[1]}`,
        title: headingMatch[2].trim(),
        status: 'pending',
      };
      steps.push(currentStep);
      continue;
    }

    // Top-level numbered list: 1. Title (only if not already inside a step from headings)
    const numberedMatch = line.match(/^(\d+)\.\s+(.+)/);
    if (numberedMatch && !line.startsWith('  ') && !line.startsWith('\t')) {
      flushDescription();
      currentStep = {
        id: `step-${numberedMatch[1]}`,
        title: numberedMatch[2].trim(),
        status: 'pending',
      };
      steps.push(currentStep);
      continue;
    }

    // Checkbox items: - [ ] Title or - [x] Title
    const checkboxMatch = line.match(/^[-*]\s+\[([ xX])\]\s+(.+)/);
    if (checkboxMatch) {
      const isChecked = checkboxMatch[1].toLowerCase() === 'x';
      const substep: PlanStep = {
        id: `substep-${steps.length}-${currentStep?.substeps?.length ?? 0}`,
        title: checkboxMatch[2].trim(),
        status: isChecked ? 'completed' : 'pending',
      };

      if (currentStep) {
        if (!currentStep.substeps) currentStep.substeps = [];
        currentStep.substeps.push(substep);
      } else {
        // Top-level checkbox becomes a main step
        steps.push(substep);
      }
      continue;
    }

    // Nested numbered items (sub-steps): starts with whitespace + number
    const nestedMatch = line.match(/^\s+(\d+)\.\s+(.+)/);
    if (nestedMatch && currentStep) {
      const substep: PlanStep = {
        id: `substep-${steps.length}-${nestedMatch[1]}`,
        title: nestedMatch[2].trim(),
        status: 'pending',
      };
      if (!currentStep.substeps) currentStep.substeps = [];
      currentStep.substeps.push(substep);
      continue;
    }

    // Description lines for current step
    if (currentStep && line.trim().length > 0) {
      descLines.push(line);
    }
  }

  flushDescription();

  // If no steps were found, return empty
  return steps;
}

/**
 * Update plan steps based on the number of completed tools since plan approval.
 * This is a best-effort heuristic: steps are marked complete in order as tools finish.
 */
export function updateStepStatuses(
  steps: PlanStep[],
  completedToolCount: number,
): PlanStep[] {
  let remaining = completedToolCount;

  return steps.map((step) => {
    if (remaining <= 0) return step;

    const substepCount = step.substeps?.length ?? 1;

    if (remaining >= substepCount) {
      remaining -= substepCount;
      return {
        ...step,
        status: 'completed' as const,
        substeps: step.substeps?.map((s) => ({ ...s, status: 'completed' as const })),
      };
    }

    // Partially complete
    const updatedSubsteps = step.substeps?.map((s, i) => ({
      ...s,
      status: i < remaining ? ('completed' as const) : s.status,
    }));
    remaining = 0;

    return {
      ...step,
      status: 'in_progress' as const,
      substeps: updatedSubsteps,
    };
  });
}
