import * as React from 'react';
import { cn } from '../../lib/utils';

export interface ScrollAreaProps extends React.HTMLAttributes<HTMLDivElement> {}

const ScrollArea = React.forwardRef<HTMLDivElement, ScrollAreaProps>(
  ({ className, children, ...props }, ref) => (
    <div
      className={cn(className, 'relative overflow-hidden')}
      {...props}
    >
      <div
        ref={ref}
        className="h-full w-full rounded-[inherit] overflow-auto"
        style={{
          WebkitOverflowScrolling: 'touch',
          touchAction: 'pan-y',
        }}
      >
        {children}
      </div>
    </div>
  ),
);
ScrollArea.displayName = 'ScrollArea';

export { ScrollArea };
