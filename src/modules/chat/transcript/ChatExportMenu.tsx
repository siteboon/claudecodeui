import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Braces, Download, FileCode2, FileText, Loader2 } from 'lucide-react';

import { ActionMenu } from '@/shared/ui';
import type { ChatMessage, DiffLine, LLMProvider, Project } from '@/shared/types';
import {
  downloadTranscriptExport,
  type TranscriptExportFormat,
} from '@/modules/chat/utils/chatExport';

type ChatExportMenuProps = {
  messages: ChatMessage[];
  sessionTitle?: string;
  provider: LLMProvider | string;
  selectedProject?: Project | null;
  createDiff: (oldStr: string, newStr: string) => DiffLine[];
  /**
   * Loads the rest of the conversation before exporting.
   *
   * The transcript is paged, so `messages` is usually the tail of it. Without
   * this, exporting a long session silently produced a file containing the
   * last twenty messages.
   */
  onLoadFullTranscript?: () => Promise<ChatMessage[]>;
};

const FORMATS: Array<{ id: TranscriptExportFormat; icon: typeof FileText; labelKey: string; descriptionKey: string }> = [
  { id: 'html', icon: FileCode2, labelKey: 'export.html.label', descriptionKey: 'export.html.description' },
  { id: 'markdown', icon: FileText, labelKey: 'export.markdown.label', descriptionKey: 'export.markdown.description' },
  { id: 'json', icon: Braces, labelKey: 'export.json.label', descriptionKey: 'export.json.description' },
];

/**
 * Rendered by chat's ChatMessagesPane header so the open conversation can be
 * downloaded as a self-contained web page, as Markdown, or as JSON.
 */
export default function ChatExportMenu({
  messages,
  sessionTitle,
  provider,
  selectedProject,
  createDiff,
  onLoadFullTranscript,
}: ChatExportMenuProps) {
  const { t } = useTranslation('chat');
  // Building a large transcript takes long enough to notice, and the download
  // only appears at the end — without this the button looks unresponsive.
  const [busyFormat, setBusyFormat] = useState<TranscriptExportFormat | null>(null);

  if (messages.length === 0) {
    return null;
  }

  const runExport = async (format: TranscriptExportFormat) => {
    setBusyFormat(format);
    try {
      const fullMessages = (await onLoadFullTranscript?.()) ?? messages;
      await downloadTranscriptExport(format, {
        messages: fullMessages.length > 0 ? fullMessages : messages,
        sessionTitle: sessionTitle?.trim() || t('export.untitled'),
        provider,
        selectedProject,
        createDiff,
      });
    } catch (error) {
      console.error('Failed to export conversation:', error);
    } finally {
      setBusyFormat(null);
    }
  };

  return (
    <ActionMenu
      icon={busyFormat ? Loader2 : Download}
      iconOnly
      label={t('export.trigger')}
      ariaLabel={t('export.trigger')}
      triggerClassName="h-8 w-8 rounded-lg border border-border/50 text-muted-foreground hover:bg-accent hover:text-foreground"
      menuClassName="w-[260px] rounded-xl p-1.5 shadow-xl"
      header={(
        <div className="mb-1 border-b border-border px-3 py-2">
          <p className="text-xs font-medium text-foreground">{t('export.heading')}</p>
        </div>
      )}
      items={FORMATS.map((format) => ({
        key: format.id,
        label: t(format.labelKey),
        description: t(format.descriptionKey),
        icon: format.icon,
        loading: busyFormat === format.id,
        onSelect: () => { void runExport(format.id); },
      }))}
    />
  );
}
