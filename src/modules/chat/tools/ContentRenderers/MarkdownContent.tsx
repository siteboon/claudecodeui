import React from 'react';

import { Markdown } from '@/modules/chat/transcript/Markdown';

type MarkdownContentProps = {
  content: string;
  className?: string;
};

/**
 * Renders markdown content with proper styling
 * Used by: exit_plan_mode, long text results, etc.
 *
 * Rendered by chat's ToolRenderer and PlanDisplay as the markdown body of a
 * tool result.
 */
export const MarkdownContent: React.FC<MarkdownContentProps> = ({
  content,
  className = 'mt-1 prose prose-sm max-w-none dark:prose-invert'
}) => {
  return (
    <Markdown className={className}>
      {content}
    </Markdown>
  );
};
