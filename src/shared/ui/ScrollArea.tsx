import * as React from 'react';

import { cn } from '@/shared/utils';

type ScrollAreaProps = React.HTMLAttributes<HTMLDivElement>;

/** Used by the file-tree and sidebar modules for consistently styled scroll containers. */
export const ScrollArea = React.forwardRef<HTMLDivElement, ScrollAreaProps>(
  ({ className, children, ...props }, ref) => (
    <div className={cn(className, 'relative overflow-hidden')} {...props}>
      {/* Inner container keeps border radius while allowing momentum scrolling on touch devices. */}
      <div
        ref={ref}
        className="h-full w-full overflow-auto rounded-[inherit]"
        style={{
          WebkitOverflowScrolling: 'touch',
          touchAction: 'pan-y',
        }}
      >
        {children}
      </div>
    </div>
  )
);

ScrollArea.displayName = 'ScrollArea';

