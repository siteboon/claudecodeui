import { CircleHelp } from 'lucide-react';

import Tooltip from './Tooltip';

type HelpTooltipProps = {
  content: string;
  label?: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
};

export default function HelpTooltip({
  content,
  label = 'Help',
  position = 'top',
}: HelpTooltipProps) {
  return (
    <Tooltip
      content={content}
      position={position}
      className="max-w-[260px] whitespace-normal px-3 py-2 text-left text-xs leading-relaxed"
    >
      <span
        aria-label={label}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        role="img"
        title={content}
      >
        <CircleHelp className="h-4 w-4" />
      </span>
    </Tooltip>
  );
}
