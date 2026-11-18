import { useTranslation } from 'react-i18next';
import { XIcon } from 'lucide-react';

import { MAX_CHAT_ATTACHMENT_COUNT, MAX_CHAT_ATTACHMENT_SIZE_MB } from '@/shared/constants';
import type { AttachmentRejection } from '@/shared/types';

type AttachmentRejectionNoticeProps = {
  rejections: AttachmentRejection[];
  onDismiss: () => void;
};

/**
 * Rendered by chat's ChatComposer above the attachment chips to name every
 * file the latest attach attempt refused and why. A refused file never gets a
 * chip, so without this it would simply be missing from the composer.
 */
const AttachmentRejectionNotice = ({ rejections, onDismiss }: AttachmentRejectionNoticeProps) => {
  const { t } = useTranslation('chat');

  if (rejections.length === 0) {
    return null;
  }

  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
    >
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          {t('input.attachmentRejected.title', { count: rejections.length })}
        </p>
        <ul className="mt-1 space-y-0.5">
          {rejections.map((rejection, index) => (
            <li key={`${rejection.fileName}-${index}`} className="flex min-w-0 gap-1">
              <span className="truncate font-medium" title={rejection.fileName}>{rejection.fileName}</span>
              <span className="shrink-0">
                {rejection.reason === 'too-large'
                  ? t('input.attachmentRejected.tooLarge', { maxSize: MAX_CHAT_ATTACHMENT_SIZE_MB })
                  : t('input.attachmentRejected.tooMany', { maxCount: MAX_CHAT_ATTACHMENT_COUNT })}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 rounded-md p-0.5 hover:bg-destructive/15 focus:outline-none focus:ring-2 focus:ring-destructive/40"
        aria-label={t('input.attachmentRejected.dismiss')}
      >
        <XIcon className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
};

export default AttachmentRejectionNotice;
