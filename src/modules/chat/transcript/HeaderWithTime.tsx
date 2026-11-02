import type { ReactNode } from 'react';

import { cn } from '@/shared/utils';

type HeaderWithTimeProps = {
  /** The header's time, or nothing to leave the header's items exactly as they are. */
  time?: ReactNode;
  /** The gap and alignment the header's row gives its items, repeated for them inside the group (`gap-1.5`, `items-start`). */
  className?: string;
  children: ReactNode;
};

/**
 * Used by chat's tool displays (BashCommandDisplay, CollapsibleSection,
 * OneLineDisplay) to put a call's time on its one-line header without taking
 * width from the header's text, whatever width the transcript column has.
 *
 * The header's own items are grouped into one flex item whose basis is the
 * width their text needs (`flex-auto`), and the time follows it. The caller's
 * row wraps (`flex-wrap`) while it shows a time and holds nothing outside this
 * component, and the time carries `ml-auto`. Flex line breaking does the rest:
 * when the text and the time fit on one line, the time sits at the row's right
 * end; when they do not, it takes a line of its own, right-aligned under the
 * text, and the text keeps the whole line. So a time never cuts the header's
 * text shorter than it is without one, and costs at most one line. With no
 * time the items are rendered as they are, so the header's markup is
 * unchanged.
 */
export default function HeaderWithTime({ time, className, children }: HeaderWithTimeProps) {
  if (!time) {
    return <>{children}</>;
  }
  return (
    <>
      <span className={cn('flex min-w-0 flex-auto items-center', className)}>{children}</span>
      {time}
    </>
  );
}
