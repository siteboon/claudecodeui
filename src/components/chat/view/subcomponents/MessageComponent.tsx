import React, { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  Brain,
  Check,
  CheckCircle2,
  Download,
  FileCode2,
  FileText,
  Folder,
  Globe,
  Image as ImageIcon,
  Loader2,
  Terminal,
  Wrench,
} from 'lucide-react';
import SessionProviderLogo from '../../../llm-logo-provider/SessionProviderLogo';
import type {
  ChatMessage,
  ClaudePermissionSuggestion,
  PermissionGrantResult,
  Provider,
} from '../../types/types';
import { Markdown } from './Markdown';
import { formatUsageLimitText } from '../../utils/chatFormatting';
import { copyTextToClipboard } from '../../../../utils/clipboard';
import type { Project } from '../../../../types/app';
import { parseChatMessageForUi } from '../../utils/chatMessageParser';
import { getClaudePermissionSuggestion } from '../../utils/chatPermissions';

type DiffLine = {
  type: string;
  content: string;
  lineNum: number;
};

interface MessageComponentProps {
  message: ChatMessage;
  index: number;
  prevMessage: ChatMessage | null;
  createDiff: (oldStr: string, newStr: string) => DiffLine[];
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  onShowSettings?: () => void;
  onGrantToolPermission?: (suggestion: ClaudePermissionSuggestion) => PermissionGrantResult | null | undefined;
  autoExpandTools?: boolean;
  showRawParameters?: boolean;
  showThinking?: boolean;
  selectedProject?: Project | null;
  provider: Provider | string;
}

type InteractiveOption = {
  number: string;
  text: string;
  isSelected: boolean;
};

const MessageComponent = memo(({ message, index, prevMessage, createDiff, onFileOpen, onShowSettings, onGrantToolPermission, autoExpandTools, showRawParameters, showThinking, selectedProject, provider }: MessageComponentProps) => {
  const { t } = useTranslation('chat');
  const isGrouped = prevMessage && prevMessage.type === message.type &&
    ((prevMessage.type === 'assistant') ||
      (prevMessage.type === 'user') ||
      (prevMessage.type === 'tool') ||
      (prevMessage.type === 'error'));
  const messageRef = React.useRef<HTMLDivElement | null>(null);
  const [isExpanded, setIsExpanded] = React.useState(false);
  const [messageCopied, setMessageCopied] = React.useState(false);
  const [permissionGrantState, setPermissionGrantState] = React.useState<'idle' | 'granted' | 'error'>('idle');

  React.useEffect(() => {
    const node = messageRef.current;
    if (!autoExpandTools || !node || !message.isToolUse) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !isExpanded) {
            setIsExpanded(true);
            const details = node.querySelectorAll<HTMLDetailsElement>('details');
            details.forEach((detail) => {
              detail.open = true;
            });
          }
        });
      },
      { threshold: 0.1 }
    );

    observer.observe(node);

    return () => {
      observer.unobserve(node);
    };
  }, [autoExpandTools, isExpanded, message.isToolUse]);

  const formattedTime = useMemo(() => new Date(message.timestamp).toLocaleTimeString(), [message.timestamp]);
  const shouldHideThinkingMessage = Boolean(message.isThinking && !showThinking);
  const parsedUiMessage = useMemo(() => parseChatMessageForUi(message), [message]);
  const permissionSuggestion = useMemo(
    () => getClaudePermissionSuggestion(message, String(provider)),
    [message, provider],
  );

  React.useEffect(() => {
    setPermissionGrantState('idle');
  }, [parsedUiMessage.toolId, permissionSuggestion?.entry]);

  if (shouldHideThinkingMessage) {
    return null;
  }

  return (
    <div
      ref={messageRef}
      className={`chat-message ${message.type} ${isGrouped ? 'grouped' : ''} ${message.type === 'user' ? 'flex justify-end px-2 sm:px-0' : 'px-2 sm:px-0'}`}
    >
      {message.type === 'user' ? (
        /* User message bubble on the right */
        <div className="flex items-end space-x-0 sm:space-x-3 w-full sm:w-auto sm:max-w-[85%] md:max-w-md lg:max-w-lg xl:max-w-xl">
          <div className="bg-gradient-to-br from-primary to-primary/90 text-primary-foreground rounded-2xl rounded-br-md px-3 sm:px-4 py-2.5 shadow-[0_14px_32px_hsl(var(--primary)/0.28)] border border-primary/20 flex-1 sm:flex-initial group">
            <div className="text-sm whitespace-pre-wrap break-words">
              {message.content}
            </div>
            {message.images && message.images.length > 0 && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                {message.images.map((img, idx) => (
                  <img
                    key={img.name || idx}
                    src={img.data}
                    alt={img.name}
                    className="rounded-lg max-w-full h-auto cursor-pointer hover:opacity-90 transition-opacity"
                    onClick={() => window.open(img.data, '_blank')}
                  />
                ))}
              </div>
            )}
            <div className="flex items-center justify-end gap-1 mt-1.5 text-xs text-primary-foreground/80">
              <button
                type="button"
                onClick={() => {
                  const text = String(message.content || '');
                  if (!text) return;

                  copyTextToClipboard(text).then((success) => {
                    if (!success) return;
                    setMessageCopied(true);
                  });
                }}
                title={messageCopied ? t('copyMessage.copied') : t('copyMessage.copy')}
                aria-label={messageCopied ? t('copyMessage.copied') : t('copyMessage.copy')}
              >
                {messageCopied ? (
                  <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                ) : (
                  <svg
                    className="w-3.5 h-3.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path>
                  </svg>
                )}
              </button>
              <span>{formattedTime}</span>
            </div>
          </div>
          {!isGrouped && (
            <div className="hidden sm:flex w-8 h-8 bg-gradient-to-br from-primary to-primary/90 rounded-full items-center justify-center text-white text-sm flex-shrink-0 shadow-sm">
              U
            </div>
          )}
        </div>
      ) : message.isTaskNotification ? (
        /* Compact task notification on the left */
        <div className="w-full">
          <div className="flex items-center gap-2 py-0.5">
            <span className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${message.taskStatus === 'completed' ? 'bg-green-400 dark:bg-green-500' : 'bg-amber-400 dark:bg-amber-500'}`} />
            <span className="text-xs text-gray-500 dark:text-gray-400">{message.content}</span>
          </div>
        </div>
      ) : (
        /* Claude/Error/Tool messages on the left */
        <div className="w-full">
          {!isGrouped && (
            <div className="flex items-center space-x-3 mb-2">
              {message.type === 'error' ? (
                <div className="w-8 h-8 bg-red-600 rounded-full flex items-center justify-center text-white text-sm flex-shrink-0">
                  !
                </div>
              ) : message.type === 'tool' ? (
                <div className="w-8 h-8 bg-gray-600 dark:bg-gray-700 rounded-full flex items-center justify-center text-white text-sm flex-shrink-0">
                  🔧
                </div>
              ) : (
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm flex-shrink-0 p-1">
                  <SessionProviderLogo provider={provider} className="w-full h-full" />
                </div>
              )}
              <div className="text-sm font-medium text-gray-900 dark:text-white">
                {message.type === 'error' ? t('messageTypes.error') : message.type === 'tool' ? t('messageTypes.tool') : (provider === 'cursor' ? t('messageTypes.cursor') : provider === 'codex' ? t('messageTypes.codex') : provider === 'gemini' ? t('messageTypes.gemini') : t('messageTypes.claude'))}
              </div>
            </div>
          )}

          <div className="w-full rounded-2xl border border-border/55 bg-card/85 backdrop-blur-sm px-3 py-3 sm:px-4 sm:py-3.5 shadow-[0_10px_30px_rgba(15,23,42,0.07)]">
            {message.isInteractivePrompt ? (
              // Special handling for interactive prompts
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 bg-amber-500 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-amber-900 dark:text-amber-100 text-base mb-3">
                      {t('interactive.title')}
                    </h4>
                    {(() => {
                      const lines = (message.content || '').split('\n').filter((line) => line.trim());
                      const questionLine = lines.find((line) => line.includes('?')) || lines[0] || '';
                      const options: InteractiveOption[] = [];

                      // Parse the menu options
                      lines.forEach((line) => {
                        // Match lines like "❯ 1. Yes" or "  2. No"
                        const optionMatch = line.match(/[❯\s]*(\d+)\.\s+(.+)/);
                        if (optionMatch) {
                          const isSelected = line.includes('❯');
                          options.push({
                            number: optionMatch[1],
                            text: optionMatch[2].trim(),
                            isSelected
                          });
                        }
                      });

                      return (
                        <>
                          <p className="text-sm text-amber-800 dark:text-amber-200 mb-4">
                            {questionLine}
                          </p>

                          {/* Option buttons */}
                          <div className="space-y-2 mb-4">
                            {options.map((option) => (
                              <button
                                key={option.number}
                                className={`w-full text-left px-4 py-3 rounded-lg border-2 transition-all ${option.isSelected
                                  ? 'bg-amber-600 dark:bg-amber-700 text-white border-amber-600 dark:border-amber-700 shadow-md'
                                  : 'bg-white dark:bg-gray-800 text-amber-900 dark:text-amber-100 border-amber-300 dark:border-amber-700'
                                  } cursor-not-allowed opacity-75`}
                                disabled
                              >
                                <div className="flex items-center gap-3">
                                  <span className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${option.isSelected
                                    ? 'bg-white/20'
                                    : 'bg-amber-100 dark:bg-amber-800/50'
                                    }`}>
                                    {option.number}
                                  </span>
                                  <span className="text-sm sm:text-base font-medium flex-1">
                                    {option.text}
                                  </span>
                                  {option.isSelected && (
                                    <span className="text-lg">❯</span>
                                  )}
                                </div>
                              </button>
                            ))}
                          </div>

                          <div className="bg-amber-100 dark:bg-amber-800/30 rounded-lg p-3">
                            <p className="text-amber-900 dark:text-amber-100 text-sm font-medium mb-1">
                              {t('interactive.waiting')}
                            </p>
                            <p className="text-amber-800 dark:text-amber-200 text-xs">
                              {t('interactive.instruction')}
                            </p>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>
            ) : (
              <>
                {parsedUiMessage.kind === 'thinking' && (
                  <details className="group rounded-xl border border-[rgba(168,130,255,0.22)] dark:border-[rgba(168,130,255,0.15)] bg-[linear-gradient(135deg,rgba(168,130,255,0.10),rgba(168,130,255,0.05))] dark:bg-[linear-gradient(135deg,rgba(168,130,255,0.08),rgba(168,130,255,0.04))] p-3" open={false}>
                    <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-violet-700 dark:text-violet-300 list-none">
                      <Brain className="h-4 w-4 text-violet-700 dark:text-violet-300" />
                      <span className={parsedUiMessage.isStreaming ? 'animate-pulse' : ''}>Thinking</span>
                      {parsedUiMessage.isStreaming && (
                        <span className="inline-flex gap-0.5 text-violet-700/80 dark:text-violet-300/80">
                          <span className="animate-bounce [animation-delay:0ms]">.</span>
                          <span className="animate-bounce [animation-delay:120ms]">.</span>
                          <span className="animate-bounce [animation-delay:240ms]">.</span>
                        </span>
                      )}
                    </summary>
                    <div className="mt-2 max-h-[260px] overflow-auto whitespace-pre-wrap font-mono text-xs leading-6 text-[#5F4B8B] dark:text-[#A198C4]">
                      {parsedUiMessage.content}
                    </div>
                  </details>
                )}

                {parsedUiMessage.kind === 'bash' && (
                  <details className={`group rounded-xl border p-3 bg-slate-900 dark:bg-[#0C0C0C] ${parsedUiMessage.status === 'running' ? 'border-yellow-500/40' : parsedUiMessage.status === 'error' ? 'border-red-500/40' : 'border-green-500/40'}`} open>
                    <summary className="flex cursor-pointer items-center gap-2 list-none">
                      {parsedUiMessage.status === 'running' ? (
                        <Loader2 className="h-4 w-4 animate-spin text-yellow-400" />
                      ) : (
                        <Terminal className={`h-4 w-4 ${parsedUiMessage.status === 'error' ? 'text-red-400' : 'text-green-400'}`} />
                      )}
                      <span className="font-mono text-green-400">$</span>
                      <span className="truncate text-sm text-slate-200">{parsedUiMessage.command}</span>
                      {Number(parsedUiMessage.exitCode) > 0 && (
                        <span className="ml-auto rounded-full border border-red-400/40 bg-red-500/20 px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide text-red-300">
                          exit {parsedUiMessage.exitCode}
                        </span>
                      )}
                    </summary>
                    {parsedUiMessage.output && (
                      <pre className="mt-2 max-h-[240px] overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-slate-300 font-mono">
                        {parsedUiMessage.output}
                      </pre>
                    )}
                  </details>
                )}

                {parsedUiMessage.kind === 'file-read' && (
                    <details className="group rounded-xl border border-blue-300/50 dark:border-slate-500/40 bg-blue-500/5 dark:bg-[rgba(30,41,59,0.5)] p-3">
                    <summary className="flex cursor-pointer items-center gap-2 list-none">
                      <FileText className="h-4 w-4 text-blue-600 dark:text-blue-300" />
                      <span className="truncate text-sm font-medium text-blue-700 dark:text-[#93C5FD]">{parsedUiMessage.filename || parsedUiMessage.path}</span>
                      <span className="ml-auto text-2xs text-slate-500 dark:text-slate-400">{parsedUiMessage.lineCount || 0} lines</span>
                      <span className="rounded-full bg-slate-200 dark:bg-slate-700/60 px-2 py-0.5 text-2xs font-semibold text-slate-700 dark:text-slate-300">
                        {parsedUiMessage.language}
                      </span>
                    </summary>
                    <div className="mt-2 max-h-[260px] overflow-auto rounded-lg border border-slate-300 dark:border-slate-700/60 bg-slate-100 dark:bg-slate-950/50 p-2 font-mono text-xs">
                      {(parsedUiMessage.content || '').split('\n').map((line, lineIndex) => (
                        <div key={`${parsedUiMessage.path}-${lineIndex}`} className="grid grid-cols-[46px_1fr] gap-3">
                          <div className="text-right text-slate-500 dark:text-slate-500">{lineIndex + 1}</div>
                          <div className="whitespace-pre-wrap break-words text-slate-700 dark:text-slate-300">{line}</div>
                        </div>
                      ))}
                    </div>
                  </details>
                )}

                {parsedUiMessage.kind === 'code-diff' && (() => {
                  let oldText = '';
                  let newText = '';
                  try {
                    const payload = JSON.parse(parsedUiMessage.content || '{}');
                    oldText = String(payload.oldContent || '');
                    newText = String(payload.newContent || '');
                  } catch {
                    oldText = '';
                    newText = '';
                  }
                  const diffLines = createDiff(oldText, newText);
                  const additions = diffLines.filter((line) => line.type === 'added').length;
                  const deletions = diffLines.filter((line) => line.type === 'removed').length;

                  return (
                    <details className="group rounded-xl border border-slate-300 dark:border-slate-600/50 bg-slate-100/80 dark:bg-[rgba(15,23,42,0.7)] p-3" open>
                      <summary className="flex cursor-pointer items-center gap-2 list-none">
                        <FileCode2 className="h-4 w-4 text-amber-700 dark:text-amber-300" />
                        <span className="truncate text-sm font-semibold text-amber-700 dark:text-amber-300">{parsedUiMessage.filename || parsedUiMessage.path}</span>
                        <span className="ml-auto inline-flex items-center gap-1 text-xs font-semibold">
                          <span className="text-emerald-700 dark:text-emerald-300">+{additions}</span>
                          <span className="text-rose-700 dark:text-rose-300">-{deletions}</span>
                        </span>
                      </summary>
                      <div className="mt-2 max-h-[320px] overflow-auto rounded-lg border border-slate-300 dark:border-slate-700/60 bg-white/90 dark:bg-slate-950/40">
                        <div className="px-3 py-1.5 text-2xs font-mono text-blue-700 dark:text-blue-300 bg-blue-500/10 border-b border-blue-500/20">
                          @@ diff @@
                        </div>
                        {diffLines.map((line, diffIndex) => (
                          <div
                            key={`${parsedUiMessage.path}-diff-${diffIndex}`}
                            className={`grid grid-cols-[18px_1fr] gap-2 px-3 py-0.5 font-mono text-xs ${
                              line.type === 'added'
                                ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                : line.type === 'removed'
                                  ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300'
                                  : 'text-slate-700 dark:text-slate-300'
                            }`}
                          >
                            <span>{line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}</span>
                            <span className="whitespace-pre-wrap break-words">{line.content}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  );
                })()}

                {parsedUiMessage.kind === 'file-write' && (
                  <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/8 dark:bg-emerald-500/5 px-3 py-2">
                    <Download className="h-4 w-4 text-emerald-700 dark:text-emerald-300" />
                    <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">Wrote</span>
                    <span className="min-w-0 break-all text-sm text-blue-700 dark:text-[#93C5FD]">{parsedUiMessage.path}</span>
                    <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-emerald-500/30 dark:border-emerald-400/40 bg-emerald-500/15 dark:bg-emerald-500/20 px-2 py-0.5 text-2xs font-semibold text-emerald-700 dark:text-emerald-300">
                      <Check className="h-3 w-3" />
                      {parsedUiMessage.status === 'created' ? 'created' : 'saved'}
                    </span>
                  </div>
                )}

                {parsedUiMessage.kind === 'web-search' && (
                  <details className="group rounded-xl border border-blue-500/30 bg-blue-500/8 dark:bg-blue-500/5 p-3">
                    <summary className="flex cursor-pointer items-center gap-2 list-none">
                      {parsedUiMessage.status === 'running' ? (
                        <Loader2 className="h-4 w-4 animate-spin text-blue-600 dark:text-blue-300" />
                      ) : (
                        <Globe className="h-4 w-4 text-blue-600 dark:text-blue-300" />
                      )}
                      <span className="text-sm font-semibold text-blue-700 dark:text-blue-300">Search:</span>
                      <span className="truncate text-sm italic text-slate-700 dark:text-slate-300">"{parsedUiMessage.query}"</span>
                      <span className="ml-auto text-2xs text-slate-500 dark:text-slate-400">{parsedUiMessage.resultCount || 0} results</span>
                    </summary>
                    <div className="mt-2 space-y-2">
                      {(parsedUiMessage.searchResults || []).map((result, resultIndex) => (
                        <div key={`${result.url || result.title}-${resultIndex}`} className="rounded-lg border border-blue-300/50 dark:border-blue-500/20 px-3 py-2">
                          <div className="text-sm font-semibold text-blue-700 dark:text-blue-300">{result.title}</div>
                          {result.url && <div className="text-xs text-slate-500 dark:text-slate-400 break-all">{result.url}</div>}
                          {result.snippet && <div className="mt-1 text-xs leading-5 text-slate-700 dark:text-slate-300">{result.snippet}</div>}
                        </div>
                      ))}
                    </div>
                  </details>
                )}

                {parsedUiMessage.kind === 'file-tree' && (
                  <details className="group rounded-xl border border-slate-300 dark:border-slate-600/50 bg-slate-100/70 dark:bg-slate-500/5 p-3">
                    <summary className="flex cursor-pointer items-center gap-2 list-none">
                      <Folder className="h-4 w-4 text-amber-600 dark:text-amber-300" />
                      <span className="truncate text-sm font-medium text-amber-700 dark:text-[#FCD34D]">{parsedUiMessage.path || 'Directory'}</span>
                      <span className="ml-auto text-2xs text-slate-500 dark:text-slate-400">{parsedUiMessage.treeItems?.length || 0} items</span>
                    </summary>
                    <div className="mt-2 space-y-1">
                      {(parsedUiMessage.treeItems || []).map((item, itemIndex) => (
                        <div key={`${item.name}-${itemIndex}`} className="flex items-center gap-2 text-xs">
                          {item.type === 'folder' ? (
                            <Folder className="h-3.5 w-3.5 text-amber-600 dark:text-amber-300" />
                          ) : (
                            <FileText className="h-3.5 w-3.5 text-blue-600 dark:text-blue-300" />
                          )}
                          <span className="truncate text-slate-700 dark:text-slate-300">{item.name}</span>
                          {item.size && <span className="ml-auto text-slate-500 dark:text-slate-500">{item.size}</span>}
                        </div>
                      ))}
                    </div>
                  </details>
                )}

                {parsedUiMessage.kind === 'error-warning' && (
                  <div className="rounded-xl border border-[rgba(248,113,113,0.28)] dark:border-[rgba(248,113,113,0.2)] bg-red-500/10 p-3">
                    <div className="flex items-center gap-2 text-red-700 dark:text-red-300">
                      <AlertTriangle className="h-4 w-4" />
                      <span className="text-sm font-semibold">Error</span>
                    </div>
                    <div className="mt-1 text-sm leading-6 text-red-700 dark:text-[#FCA5A5] whitespace-pre-wrap">{parsedUiMessage.content}</div>
                    {parsedUiMessage.details && (
                      <div className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-400 whitespace-pre-wrap">{parsedUiMessage.details}</div>
                    )}
                    {onGrantToolPermission && permissionSuggestion && parsedUiMessage.permissionRequest && (
                      <div className="mt-3 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const result = onGrantToolPermission(permissionSuggestion);
                            if (result?.success) {
                              setPermissionGrantState('granted');
                            } else {
                              setPermissionGrantState('error');
                            }
                          }}
                          disabled={permissionSuggestion.isAllowed || permissionGrantState === 'granted'}
                          className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                            permissionSuggestion.isAllowed || permissionGrantState === 'granted'
                              ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                              : 'border-red-400/40 bg-red-500/10 text-red-700 dark:text-red-200 hover:bg-red-500/20'
                          }`}
                        >
                          {permissionSuggestion.isAllowed || permissionGrantState === 'granted' ? 'Permission added' : `Allow ${permissionSuggestion.toolName}`}
                        </button>
                        {permissionGrantState === 'error' && (
                          <span className="text-xs text-red-800 dark:text-red-300">Could not update permission rule</span>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {parsedUiMessage.kind === 'tool-invocation' && (
                  <details className="group rounded-xl border border-violet-500/30 bg-violet-500/8 dark:bg-violet-500/5 p-3">
                    <summary className="flex cursor-pointer items-center gap-2 list-none">
                      {parsedUiMessage.status === 'running' ? (
                        <Loader2 className="h-4 w-4 animate-spin text-violet-700 dark:text-violet-300" />
                      ) : (
                        <Wrench className="h-4 w-4 text-violet-700 dark:text-violet-300" />
                      )}
                      <span className="text-sm text-violet-700 dark:text-[#C4B5FD] font-medium">{parsedUiMessage.toolName}</span>
                    </summary>
                    <pre className="mt-2 max-h-[260px] overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-slate-700 dark:text-slate-300 font-mono">
                      {parsedUiMessage.toolInputRaw}
                    </pre>
                    {parsedUiMessage.content && (
                      <pre className="mt-2 max-h-[280px] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-violet-400/20 dark:border-violet-300/20 bg-violet-500/10 dark:bg-violet-500/5 p-2 text-xs leading-5 text-slate-700 dark:text-slate-200 font-mono">
                        {parsedUiMessage.content}
                      </pre>
                    )}
                  </details>
                )}

                {parsedUiMessage.kind === 'image-generation' && (
                  <div className="rounded-xl border border-pink-500/30 bg-pink-500/8 dark:bg-pink-500/5 p-3">
                    <div className="flex items-center gap-2">
                      {parsedUiMessage.status === 'generating' ? (
                        <Loader2 className="h-4 w-4 animate-spin text-pink-700 dark:text-pink-300" />
                      ) : (
                        <ImageIcon className="h-4 w-4 text-pink-700 dark:text-pink-300" />
                      )}
                      <span className="text-sm font-semibold text-pink-700 dark:text-[#F9A8D4]">Image Generation</span>
                      <span className={`ml-auto rounded-full px-2 py-0.5 text-2xs font-semibold ${parsedUiMessage.status === 'generating' ? 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-300' : 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'}`}>
                        {parsedUiMessage.status === 'generating' ? 'Generating...' : 'Complete'}
                      </span>
                    </div>
                    {parsedUiMessage.status === 'done' && (
                      <div className="mt-2">
                        {(() => {
                          const outputs = parsedUiMessage.outputs || [];
                          const imageUrls = outputs.filter((value) => /^(https?:\/\/|data:image\/)/i.test(value));
                          if (imageUrls.length > 0) {
                            return (
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {imageUrls.map((imageUrl, imageIndex) => (
                                  <img
                                    key={`${imageUrl}-${imageIndex}`}
                                    src={imageUrl}
                                    alt={`Generated ${imageIndex + 1}`}
                                    className="w-full h-auto rounded-lg border border-pink-400/20 dark:border-pink-300/20"
                                  />
                                ))}
                              </div>
                            );
                          }

                          const textOutput = outputs.find((value) => value.trim().length > 0) || String(parsedUiMessage.content || '');
                          if (textOutput.trim()) {
                            return (
                              <pre className="max-h-[240px] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-pink-400/20 dark:border-pink-300/20 bg-white/50 dark:bg-slate-900/40 p-2 text-xs leading-5 text-slate-700 dark:text-slate-200">
                                {textOutput}
                              </pre>
                            );
                          }

                          return (
                            <div className="h-20 rounded-lg border border-dashed border-pink-400/30 dark:border-pink-300/30 flex items-center justify-center text-xs text-slate-600 dark:text-slate-300">
                              No generated output available
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                )}

                {parsedUiMessage.kind === 'summary-completion' && (
                  <div className="rounded-xl border border-[rgba(52,211,153,0.24)] dark:border-[rgba(52,211,153,0.12)] bg-emerald-500/8 dark:bg-emerald-500/5 p-3">
                    <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
                      <CheckCircle2 className="h-4 w-4" />
                      <span className="text-sm font-semibold">{parsedUiMessage.title || 'Complete'}</span>
                    </div>
                    <div className="mt-2 space-y-1 text-xs font-mono text-slate-700 dark:text-slate-300">
                      {(parsedUiMessage.listItems || []).map((item, itemIndex) => (
                        <div key={`${item}-${itemIndex}`}>• {item}</div>
                      ))}
                    </div>
                  </div>
                )}

                {parsedUiMessage.kind === 'streaming-prose' && (
                  <div className="text-sm leading-[1.75] text-slate-700 dark:text-slate-200 [font-family:'Source_Serif_4','ui-serif',Georgia,serif]">
                    <Markdown className="prose prose-sm max-w-none dark:prose-invert prose-slate dark:prose-invert prose-headings:text-slate-800 dark:prose-headings:text-slate-100 prose-p:text-slate-700 dark:prose-p:text-slate-200 prose-strong:text-slate-900 dark:prose-strong:text-slate-100 prose-code:text-sky-700 dark:prose-code:text-sky-300 prose-pre:bg-slate-100 dark:prose-pre:bg-slate-900 prose-pre:border prose-pre:border-slate-300 dark:prose-pre:border-slate-700 prose-a:text-blue-700 dark:prose-a:text-blue-300">
                      {formatUsageLimitText(String(parsedUiMessage.content || ''))}
                    </Markdown>
                    {parsedUiMessage.isStreaming && (
                      <span className="inline-block ml-1 align-middle h-[18px] w-[2px] bg-[#60A5FA] animate-pulse" />
                    )}
                  </div>
                )}
              </>
            )}

            {!isGrouped && (
              <div className="text-2xs text-gray-400 dark:text-gray-500 mt-1">
                {formattedTime}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

export default MessageComponent;
