import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { formatAnsweringModelLabel } from '@/modules/chat/utils/modelLabel';

/**
 * Used by chat's MessageComponent to name the model that answered a turn, in
 * the message footer beside the copy control.
 *
 * Only the provider's own word for the row is rendered — never the model
 * picker's current value, which says what the next turn would use rather than
 * what this one ran on. A reply the provider reported no model for (a row it
 * fabricated locally, such as the usage-limit notice) gets no label at all.
 */
const MessageModelLabel = memo(({ model }: { model?: string }) => {
  const { t } = useTranslation('chat');
  const label = formatAnsweringModelLabel(model);

  if (!label) {
    return null;
  }

  const answeredBy = t('message.answeredBy', {
    model: model?.trim(),
    defaultValue: 'Answered by {{model}}',
  });

  return (
    <span
      title={answeredBy}
      aria-label={answeredBy}
      className="whitespace-nowrap text-[10px] font-semibold tracking-wide"
    >
      {label}
    </span>
  );
});
MessageModelLabel.displayName = 'MessageModelLabel';

export default MessageModelLabel;
