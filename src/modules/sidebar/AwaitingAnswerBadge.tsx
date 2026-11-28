import type { TFunction } from 'i18next';

type AwaitingAnswerBadgeProps = {
  t: TFunction;
};

/** Used by SidebarRecentConversations, SidebarSessionItem and SidebarProjectItem to mark blocked sessions waiting on the user. */
export default function AwaitingAnswerBadge({ t }: AwaitingAnswerBadgeProps) {
  return (
    <span className="flex flex-shrink-0 items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium leading-tight text-amber-800 dark:text-amber-300">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-600 dark:bg-amber-400" aria-hidden="true" />
      {t('badges.awaitingAnswer', { defaultValue: 'Awaiting answer' })}
    </span>
  );
}
