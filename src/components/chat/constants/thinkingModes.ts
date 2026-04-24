import { Brain, Gauge, Sparkles, Atom, Flame } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type ThinkingMode = {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon | null;
  effort: EffortLevel;
  color: string;
};

export const thinkingModes: ThinkingMode[] = [
  {
    id: 'low',
    name: 'Low',
    description: 'Minimal thinking, fastest responses',
    icon: Gauge,
    effort: 'low',
    color: 'text-blue-600'
  },
  {
    id: 'medium',
    name: 'Medium',
    description: 'Moderate thinking',
    icon: Brain,
    effort: 'medium',
    color: 'text-purple-600'
  },
  {
    id: 'high',
    name: 'High',
    description: 'Deep reasoning (SDK default)',
    icon: Sparkles,
    effort: 'high',
    color: 'text-indigo-600'
  },
  {
    id: 'xhigh',
    name: 'Extra High',
    description: 'Higher reasoning budget',
    icon: Flame,
    effort: 'xhigh',
    color: 'text-orange-600'
  },
  {
    id: 'max',
    name: 'Max',
    description: 'Maximum effort (Opus 4.6/4.7 only)',
    icon: Atom,
    effort: 'max',
    color: 'text-red-600'
  }
];

export const DEFAULT_THINKING_MODE_ID = 'high';

export function getEffortForModeId(id: string): EffortLevel | null {
  return thinkingModes.find((m) => m.id === id)?.effort ?? null;
}
