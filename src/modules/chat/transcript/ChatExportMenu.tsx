import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRightLeft, Braces, Download, FileCode2, FileText, Loader2 } from 'lucide-react';

import { ActionMenu } from '@/shared/ui';
import { readDraftText, writeDraftText } from '@/shared/chatDrafts';
import type { ChatMessage, DiffLine, LLMProvider, Project } from '@/shared/types';
import {
  downloadTranscriptExport,
  type TranscriptExportFormat,
} from '@/modules/chat/utils/chatExport';
import { buildHandoffMarkdown } from '@/modules/chat/export/buildTranscriptMarkdown';

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
  /** Opens a new chat in the project; enables "Continue in new chat". */
  onNewSession?: (project: Project) => void;
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
  onNewSession,
}: ChatExportMenuProps) {
  const { t } = useTranslation('chat');
  // Building a large transcript takes long enough to notice, and the download
  // only appears at the end — without this the button looks unresponsive.
  const [busyFormat, setBusyFormat] = useState<TranscriptExportFormat | 'handoff' | null>(null);
  // Whether the side-question asides go into the file. Off by default, so a plain export
  // matches what the session itself saw; the operator opts in from this option.
  const [includeSideQuestions, setIncludeSideQuestions] = useState(false);

  if (messages.length === 0) {
    return null;
  }

  const loadMessages = async () => {
    const fullMessages = (await onLoadFullTranscript?.()) ?? messages;
    return fullMessages.length > 0 ? fullMessages : messages;
  };

  const runExport = async (format: TranscriptExportFormat) => {
    setBusyFormat(format);
    try {
      await downloadTranscriptExport(format, {
        messages: await loadMessages(),
        sessionTitle: sessionTitle?.trim() || t('export.untitled'),
        provider,
        selectedProject,
        createDiff,
        includeSideQuestions,
      });
    } catch (error) {
      console.error('Failed to export conversation:', error);
    } finally {
      setBusyFormat(null);
    }
  };

  // The digest lands in the new chat's draft, where the user picks the other
  // provider and can edit it before sending.
  const continueInNewChat = async (project: Project, openNewSession: (project: Project) => void) => {
    setBusyFormat('handoff');
    try {
      const scope = `project:${project.projectId}`;
      const digest = buildHandoffMarkdown({
        messages: await loadMessages(),
        sessionTitle: sessionTitle?.trim() || t('export.untitled'),
        provider,
      });
      // Keep whatever was already typed for a new chat in this project.
      const existing = readDraftText(scope).trim();
      writeDraftText(scope, existing ? `${existing}\n\n${digest}` : digest);
      openNewSession(project);
    } catch (error) {
      console.error('Failed to continue conversation in a new chat:', error);
    } finally {
      setBusyFormat(null);
    }
  };

  const items = FORMATS.map((format) => ({
    key: format.id as string,
    label: t(format.labelKey),
    description: t(format.descriptionKey),
    icon: format.icon,
    loading: busyFormat === format.id,
    onSelect: () => { void runExport(format.id); },
  }));
  if (selectedProject && onNewSession) {
    items.push({
      key: 'handoff',
      label: t('export.handoff.label'),
      description: t('export.handoff.description'),
      icon: ArrowRightLeft,
      loading: busyFormat === 'handoff',
      onSelect: () => { void continueInNewChat(selectedProject, onNewSession); },
    });
  }

  return (
    <ActionMenu
      icon={busyFormat ? Loader2 : Download}
      iconOnly
      label={t('export.trigger')}
      ariaLabel={t('export.trigger')}
      triggerClassName="h-8 w-8 rounded-lg border border-border/50 text-muted-foreground hover:bg-accent hover:text-foreground"
      menuClassName="w-[260px] rounded-xl p-1.5 shadow-xl"
      header={(
        <div className="space-y-1.5 border-b border-border px-3 py-2">
          <p className="text-xs font-medium text-foreground">{t('export.heading')}</p>
          {/*
            The side-question asides are not part of the session, so the file leaves them
            out unless this stays on. It is drawn as a checkbox (not a menu
            item) so it does not close the menu when it is toggled.
          */}
          <label className="flex cursor-pointer select-none items-center gap-2 rounded-md px-1 py-0.5 text-xs text-muted-foreground hover:text-foreground">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-primary"
              checked={includeSideQuestions}
              onChange={(event) => setIncludeSideQuestions(event.target.checked)}
            />
            {t('export.includeSideQuestions')}
          </label>
        </div>
      )}
      items={items}
    />
  );
}
