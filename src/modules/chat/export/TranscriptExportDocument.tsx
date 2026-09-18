import { I18nextProvider } from 'react-i18next';

import { i18n } from '@/modules/i18n';
import type { ChatMessage, DiffLine, LLMProvider, Project } from '@/shared/types';
import { TranscriptRenderContext } from '@/modules/chat/context/TranscriptRenderContext';
import MessageComponent from '@/modules/chat/transcript/MessageComponent';
import ToolGroupContainer from '@/modules/chat/transcript/ToolGroupContainer';
import { groupConsecutiveTools, isToolGroupItem } from '@/modules/chat/utils/toolGrouping';

type TranscriptExportDocumentProps = {
  messages: ChatMessage[];
  createDiff: (oldStr: string, newStr: string) => DiffLine[];
  provider: LLMProvider | string;
  selectedProject?: Project | null;
};

/**
 * The transcript, rendered for a document instead of a screen.
 *
 * It deliberately mounts the same `MessageComponent` / `ToolGroupContainer`
 * tree the chat pane uses. Every previous export was a second formatter that
 * only knew about `msg.type`, which is why tool calls — the bulk of an agent
 * transcript — came out as empty sections. Rendering the real components means
 * the export cannot fall behind the UI: a new tool renderer appears in it for
 * free.
 *
 * Rendered by `buildTranscriptHtml` through `renderToStaticMarkup`, so there
 * are no effects and no interactivity — anything the components hide behind
 * open state is force-shown via `TranscriptRenderContext`.
 */
export function TranscriptExportDocument({
  messages,
  createDiff,
  provider,
  selectedProject,
}: TranscriptExportDocumentProps) {
  // Thinking blocks are included: an export is a record of what happened, and
  // the on-screen toggle is about noise in a live conversation.
  const grouped = groupConsecutiveTools(messages, true);
  let previousMessage: ChatMessage | null = null;

  return (
    <I18nextProvider i18n={i18n}>
      <TranscriptRenderContext.Provider value={{ isExporting: true }}>
        <div className="chat-export-transcript">
          {grouped.map((item, index) => {
            if (isToolGroupItem(item)) {
              const groupPreviousMessage = previousMessage;
              previousMessage = item.messages[item.messages.length - 1] || previousMessage;

              return (
                <ToolGroupContainer
                  key={`group-${index}`}
                  group={item}
                  prevMessage={groupPreviousMessage}
                  createDiff={createDiff}
                  getMessageKey={(message: ChatMessage) => String(message.timestamp)}
                  showRawParameters={false}
                  showThinking
                  selectedProject={selectedProject}
                  provider={provider}
                />
              );
            }

            const messagePreviousMessage = previousMessage;
            previousMessage = item;

            return (
              <MessageComponent
                key={`message-${index}`}
                message={item}
                prevMessage={messagePreviousMessage}
                createDiff={createDiff}
                showRawParameters={false}
                showThinking
                selectedProject={selectedProject}
                provider={provider}
              />
            );
          })}
        </div>
      </TranscriptRenderContext.Provider>
    </I18nextProvider>
  );
}
