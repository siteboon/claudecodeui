import { useEffect, useRef, useState } from 'react';
import type { ClipboardEvent, FormEvent, KeyboardEvent } from 'react';
import { MessageCircleQuestion, PaperclipIcon, Trash2, XIcon, Loader2 } from 'lucide-react';

import ComposerModelMenu from '@/modules/chat/composer/ComposerModelMenu';
import {
  PromptInput,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from '@/modules/chat/composer/PromptInput';
import type { SideChatEntry } from '@/modules/chat/hooks/useSideChat';
import { Markdown } from '@/modules/chat/transcript/Markdown';
import type { ProviderModelOption } from '@/shared/types';

type EffortOption = NonNullable<ProviderModelOption['effort']>['values'][number];

type SideChatPanelProps = {
  entries: SideChatEntry[];
  busy: boolean;
  onAsk: (question: string, files: File[]) => void;
  onStop: () => void;
  onClear: () => void;
  onClose: () => void;
  model: string;
  modelOptions: ProviderModelOption[];
  onSelectModel: (model: string) => void;
  effort: string;
  effortOptions: EffortOption[];
  onSelectEffort: (effort: string) => void;
  modelsLoading: boolean;
};

const MAX_FILES = 5;

/**
 * Rendered by ChatInterface in the side-panel frame beside the transcript
 * while the /btw side chat is open: questions about this chat, answered from
 * its context, never added to it. Its control bar mirrors the main one —
 * attach, model, send / stop.
 */
export default function SideChatPanel({
  entries,
  busy,
  onAsk,
  onStop,
  onClear,
  onClose,
  model,
  modelOptions,
  onSelectModel,
  effort,
  effortOptions,
  onSelectEffort,
  modelsLoading,
}: SideChatPanelProps) {
  const [input, setInput] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Keep the newest exchange in view as questions and answers arrive.
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [entries]);

  const addFiles = (added: File[]) => {
    const pictures = added.filter((file) => file.type.startsWith('image/'));
    if (pictures.length > 0) {
      setFiles((previous) => [...previous, ...pictures].slice(0, MAX_FILES));
    }
  };

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (busy) {
      onStop();
      return;
    }
    // "/btw" typed here again is the same thing; take the question after it.
    const question = input.replace(/^\s*\/btw\b/, '').trim();
    if (!question) {
      return;
    }
    onAsk(question, files);
    setInput('');
    setFiles([]);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    } else if (event.key === 'Escape' && !input) {
      onClose();
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = Array.from(event.clipboardData.files);
    if (pasted.length > 0) {
      event.preventDefault();
      addFiles(pasted);
    }
  };

  return (
    <section aria-label="Side chat" className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-start gap-3 border-b border-border px-4 py-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-muted">
          <MessageCircleQuestion className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">Side chat</p>
          <p className="text-xs text-muted-foreground">Answered from this chat's context. Not added to the chat.</p>
        </div>
        {entries.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            title="Clear the side chat"
            aria-label="Clear the side chat"
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          title="Close the side chat"
          aria-label="Close the side chat"
          className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <XIcon className="h-4 w-4" />
        </button>
      </header>

      <div ref={listRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {entries.length === 0 && (
          <p className="mt-8 text-center text-sm text-muted-foreground">
            Ask anything about this chat. Claude keeps working on the main task meanwhile.
          </p>
        )}
        {entries.map((entry) => (
          <div key={entry.id} className="space-y-2">
            <div className="ml-8 rounded-2xl bg-muted px-3.5 py-2.5 text-sm text-foreground">
              {entry.previews.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {entry.previews.map((url) => (
                    <img key={url} src={url} alt="" className="h-16 w-16 rounded-lg border border-border object-cover" />
                  ))}
                </div>
              )}
              <p className="whitespace-pre-wrap break-words">{entry.question}</p>
            </div>
            <div className="text-sm">
              {entry.error ? (
                <p className="text-red-600 dark:text-red-400">{entry.error}</p>
              ) : entry.answer === null ? (
                <p className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Thinking…
                </p>
              ) : (
                <Markdown>{entry.answer}</Markdown>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-border p-3">
        <PromptInput onSubmit={submit} status={busy ? 'streaming' : 'ready'}>
          {files.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-3 pt-3">
              {files.map((file, index) => (
                <button
                  key={`${file.name}-${index}`}
                  type="button"
                  onClick={() => setFiles((previous) => previous.filter((_, current) => current !== index))}
                  title={`Remove ${file.name}`}
                  className="rounded-md border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  {file.name} ×
                </button>
              ))}
            </div>
          )}
          <PromptInputBody>
            <PromptInputTextarea
              ref={textareaRef}
              dir="auto"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              placeholder="Ask a side question…"
            />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputTools>
              <PromptInputButton
                tooltip={{ content: 'Attach pictures' }}
                onClick={() => fileInputRef.current?.click()}
                aria-label="Attach pictures"
              >
                <PaperclipIcon />
              </PromptInputButton>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(event) => {
                  addFiles(Array.from(event.target.files ?? []));
                  event.target.value = '';
                }}
              />
            </PromptInputTools>
            <div className="ml-auto flex shrink-0 items-center gap-1.5">
              <ComposerModelMenu
                effort={effort}
                effortOptions={effortOptions}
                onSelectEffort={onSelectEffort}
                model={model}
                modelOptions={modelOptions}
                onSelectModel={onSelectModel}
                modelsLoading={modelsLoading}
              />
              <PromptInputSubmit
                onClick={busy ? (event) => { event.preventDefault(); onStop(); } : undefined}
                disabled={!busy && !input.replace(/^\s*\/btw\b/, '').trim()}
                aria-label={busy ? 'Stop' : 'Send'}
                title={busy ? 'Stop' : 'Send'}
                className="h-9 w-9"
              />
            </div>
          </PromptInputFooter>
        </PromptInput>
      </div>
    </section>
  );
}
