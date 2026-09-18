import * as React from 'react';

import { cn } from '@/shared/utils';

type ShimmerProps = {
  children: string;
  className?: string;
  as?: React.ElementType;
};

/** Used by the chat module for streaming placeholder text and by the shared Reasoning primitive. */
export const Shimmer = React.memo<ShimmerProps>(({ children, className, as: Component = 'span' }) => {
  return (
    <Component
      className={cn(
        'animate-shimmer inline-block bg-[length:250%_100%] bg-clip-text text-transparent',
        'bg-[linear-gradient(90deg,transparent_33%,hsl(var(--foreground))_50%,transparent_67%),linear-gradient(hsl(var(--muted-foreground)),hsl(var(--muted-foreground)))]',
        className
      )}
    >
      {children}
    </Component>
  );
});
Shimmer.displayName = 'Shimmer';

