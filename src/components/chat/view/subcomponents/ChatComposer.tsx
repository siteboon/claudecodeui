import { useTranslation } from 'react-i18next';
import type {
  ChangeEvent,
  ClipboardEvent,
  Dispatch,
  FormEvent,
  KeyboardEvent,
  MouseEvent,
  ReactNode,
  RefObject,
  SetStateAction,
  TouchEvent,
} from 'react';
import { useState, type RefObject as InputRefObject } from 'react';
import { useWebSocket } from '../../../../contexts/WebSocketContext';
import { ImageIcon, PaperclipIcon, FolderIcon, FileIcon, MessageSquareIcon, XIcon, ArrowDownIcon } from 'lucide-react';
import type { PendingPermissionRequest, PermissionMode, Provider } from '../../types/types';
import CommandMenu from './CommandMenu';
import ClaudeStatus from './ClaudeStatus';
import ImageAttachment from './ImageAttachment';
import FileAttachment from './FileAttachment';
import PermissionRequestsBanner from './PermissionRequestsBanner';
import ModePills, { type ModePill } from './ModePills';
import { thinkingModes } from '../../constants/thinkingModes';
import TokenUsagePie from './TokenUsagePie';
import ModelSelector from './ModelSelector';
import { getClaudeContextWindow } from '../../../../../shared/modelConstants';
import {
  PromptInput,
  PromptInputHeader,
  PromptInputBody,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputTools,
  PromptInputButton,
  PromptInputSubmit,
} from '../../../../shared/view/ui';

interface MentionableFile {
  name: string;
  path: string;
}

interface SlashCommand {
  name: string;
  description?: string;
  namespace?: string;
  path?: string;
  type?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

interface ChatComposerProps {
  pendingPermissionRequests: PendingPermissionRequest[];
  handlePermissionDecision: (
    requestIds: string | string[],
    decision: { allow?: boolean; message?: string; rememberEntry?: string | null; updatedInput?: unknown },
  ) => void;
  handleGrantToolPermission: (suggestion: { entry: string; toolName: string }) => { success: boolean };
  claudeStatus: { text: string; tokens: number; can_interrupt: boolean } | null;
  isLoading: boolean;
  onAbortSession: () => void;
  provider: Provider | string;
  permissionMode: PermissionMode | string;
  onPermissionModeSelect: (mode: PermissionMode) => void;
  thinkingMode: string;
  setThinkingMode: Dispatch<SetStateAction<string>>;
  claudeModel: string;
  setClaudeModel: (model: string) => void;
  tokenBudget: { used?: number; total?: number } | null;
  slashCommandsCount: number;
  onToggleCommandMenu: () => void;
  hasInput: boolean;
  onClearInput: () => void;
  isUserScrolledUp: boolean;
  hasMessages: boolean;
  onScrollToBottom: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement> | MouseEvent<HTMLButtonElement> | TouchEvent<HTMLButtonElement>) => void;
  isDragActive: boolean;
  attachedImages: File[];
  onRemoveImage: (index: number) => void;
  uploadingImages: Map<string, number>;
  imageErrors: Map<string, string>;
  attachedFiles: File[];
  onRemoveFile: (index: number) => void;
  fileErrors: Map<string, string>;
  fileInputRef: InputRefObject<HTMLInputElement>;
  folderInputRef: InputRefObject<HTMLInputElement>;
  openFilePicker: () => void;
  openFolderPicker: () => void;
  onFileSelection: (files: File[]) => void;
  showFileDropdown: boolean;
  filteredFiles: MentionableFile[];
  selectedFileIndex: number;
  onSelectFile: (file: MentionableFile) => void;
  filteredCommands: SlashCommand[];
  selectedCommandIndex: number;
  onCommandSelect: (command: SlashCommand, index: number, isHover: boolean) => void;
  onCloseCommandMenu: () => void;
  isCommandMenuOpen: boolean;
  frequentCommands: SlashCommand[];
  getRootProps: (...args: unknown[]) => Record<string, unknown>;
  getInputProps: (...args: unknown[]) => Record<string, unknown>;
  openImagePicker: () => void;
  inputHighlightRef: RefObject<HTMLDivElement>;
  renderInputWithMentions: (text: string) => ReactNode;
  textareaRef: RefObject<HTMLTextAreaElement>;
  input: string;
  onInputChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onTextareaClick: (event: MouseEvent<HTMLTextAreaElement>) => void;
  onTextareaKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onTextareaPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  onTextareaScrollSync: (target: HTMLTextAreaElement) => void;
  onTextareaInput: (event: FormEvent<HTMLTextAreaElement>) => void;
  onInputFocusChange?: (focused: boolean) => void;
  placeholder: string;
  isTextareaExpanded: boolean;
  sendByCtrlEnter?: boolean;
  queuedMessage?: string | null;
  onCancelQueue?: () => void;
  onCompact?: () => void;
}

export default function ChatComposer({
  pendingPermissionRequests,
  handlePermissionDecision,
  handleGrantToolPermission,
  claudeStatus,
  isLoading,
  onAbortSession,
  provider,
  permissionMode,
  onPermissionModeSelect,
  thinkingMode,
  setThinkingMode,
  claudeModel,
  setClaudeModel,
  tokenBudget,
  slashCommandsCount,
  onToggleCommandMenu,
  hasInput,
  onClearInput,
  isUserScrolledUp,
  hasMessages,
  onScrollToBottom,
  onSubmit,
  isDragActive,
  attachedImages,
  onRemoveImage,
  uploadingImages,
  imageErrors,
  attachedFiles,
  onRemoveFile,
  fileErrors,
  fileInputRef,
  folderInputRef,
  openFilePicker,
  openFolderPicker,
  onFileSelection,
  showFileDropdown,
  filteredFiles,
  selectedFileIndex,
  onSelectFile,
  filteredCommands,
  selectedCommandIndex,
  onCommandSelect,
  onCloseCommandMenu,
  isCommandMenuOpen,
  frequentCommands,
  getRootProps,
  getInputProps,
  openImagePicker,
  inputHighlightRef,
  renderInputWithMentions,
  textareaRef,
  input,
  onInputChange,
  onTextareaClick,
  onTextareaKeyDown,
  onTextareaPaste,
  onTextareaScrollSync,
  onTextareaInput,
  onInputFocusChange,
  placeholder,
  isTextareaExpanded,
  sendByCtrlEnter,
  queuedMessage,
  onCancelQueue,
  onCompact,
}: ChatComposerProps) {
  const { t } = useTranslation('chat');
  const textareaRect = textareaRef.current?.getBoundingClientRect();
  const commandMenuPosition = {
    top: textareaRect ? Math.max(16, textareaRect.top - 316) : 0,
    left: textareaRect ? textareaRect.left : 16,
    bottom: textareaRect ? window.innerHeight - textareaRect.top + 8 : 90,
  };

  const [showAttachMenu, setShowAttachMenu] = useState(false);

  // Surface WS sends that were issued while disconnected. Without this, a user
  // who hits send during a brief WS outage sees their textarea cleared and the
  // chat scrolling to a (transient) optimistic bubble that may be wiped when
  // the session refetches on reconnect — i.e. the message looks "forgotten".
  // The indicator stays visible until the queue flushes on the next onopen.
  const { pendingSendCount, lastPendingSendText } = useWebSocket();
  // Show whenever the queue is non-empty — by construction, payloads only land
  // there when the socket was closed at send time, and the queue clears the
  // moment onopen flushes them. Gating on isConnected as well introduces a
  // race: onclose is async, so a send issued ~immediately after a programmatic
  // close (or a same-tick close) can land in the queue before isConnected
  // flips to false, and the indicator would briefly miss its window.
  const showPendingSendIndicator = pendingSendCount > 0;

  // Detect if the AskUserQuestion interactive panel is active
  const hasQuestionPanel = pendingPermissionRequests.some(
    (r) => r.toolName === 'AskUserQuestion'
  );

  // Hide the thinking/status bar while any permission request is pending
  const hasPendingPermissions = pendingPermissionRequests.length > 0;

  return (
    <div className="flex-shrink-0 p-2 pb-2 sm:p-4 sm:pb-4 md:p-4 md:pb-6">
      {!hasPendingPermissions && (
        <ClaudeStatus
          status={claudeStatus}
          isLoading={isLoading}
          onAbort={onAbortSession}
          provider={provider}
        />
      )}

      {pendingPermissionRequests.length > 0 && (
        <div className="mx-auto mb-3 max-w-4xl">
          <PermissionRequestsBanner
            pendingPermissionRequests={pendingPermissionRequests}
            handlePermissionDecision={handlePermissionDecision}
            handleGrantToolPermission={handleGrantToolPermission}
          />
        </div>
      )}

      {showPendingSendIndicator && (
        <div
          data-pending-send="true"
          className="mx-auto mb-2 flex max-w-4xl items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-300"
        >
          <span className="h-1.5 w-1.5 flex-shrink-0 animate-pulse rounded-full bg-amber-500" />
          <span className="flex-1 truncate">
            {lastPendingSendText
              ? `Reconnecting... will send: ${lastPendingSendText}`
              : `Reconnecting... ${pendingSendCount} message(s) waiting to send`}
          </span>
        </div>
      )}

      {queuedMessage && (
        <div
          data-pending-send="true"
          className="mx-auto mb-2 flex max-w-4xl items-center gap-2 rounded-lg border border-border/50 bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground"
        >
          <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-400" />
          <span className="flex-1 truncate">Queued: {queuedMessage}</span>
          {onCancelQueue && (
            <button type="button" onClick={onCancelQueue} className="flex-shrink-0 hover:text-foreground" aria-label="Cancel queued message">
              <XIcon className="h-3 w-3" />
            </button>
          )}
        </div>
      )}

      {!hasQuestionPanel && <div className="relative mx-auto max-w-4xl">
        {isUserScrolledUp && hasMessages && (
          <div className="absolute -top-10 left-0 right-0 z-10 flex justify-center">
            <button
              type="button"
              onClick={onScrollToBottom}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-border/50 bg-card text-muted-foreground shadow-sm transition-all duration-200 hover:bg-accent hover:text-foreground"
              title={t('input.scrollToBottom', { defaultValue: 'Scroll to bottom' })}
            >
              <ArrowDownIcon className="h-4 w-4" />
            </button>
          </div>
        )}
        {showFileDropdown && filteredFiles.length > 0 && (
          <div className="absolute bottom-full left-0 right-0 z-50 mb-2 max-h-48 overflow-y-auto rounded-xl border border-border/50 bg-card/95 shadow-lg backdrop-blur-md">
            {filteredFiles.map((file, index) => (
              <div
                key={file.path}
                className={`cursor-pointer touch-manipulation border-b border-border/30 px-4 py-3 last:border-b-0 ${
                  index === selectedFileIndex
                    ? 'bg-primary/8 text-primary'
                    : 'text-foreground hover:bg-accent/50'
                }`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onSelectFile(file);
                }}
              >
                <div className="text-sm font-medium">{file.name}</div>
                <div className="font-mono text-xs text-muted-foreground">{file.path}</div>
              </div>
            ))}
          </div>
        )}

        <CommandMenu
          commands={filteredCommands}
          selectedIndex={selectedCommandIndex}
          onSelect={onCommandSelect}
          onClose={onCloseCommandMenu}
          position={commandMenuPosition}
          isOpen={isCommandMenuOpen}
          frequentCommands={frequentCommands}
        />

        <PromptInput
          onSubmit={onSubmit as (event: FormEvent<HTMLFormElement>) => void}
          status={isLoading ? 'streaming' : 'ready'}
          className={isTextareaExpanded ? 'chat-input-expanded' : ''}
          {...getRootProps()}
        >
          {isDragActive && (
            <div className="absolute inset-0 z-50 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary/50 bg-primary/15">
              <div className="rounded-xl border border-border/30 bg-card p-4 shadow-lg">
                <svg className="mx-auto mb-2 h-8 w-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                  />
                </svg>
                <p className="text-sm font-medium">Drop files here</p>
              </div>
            </div>
          )}

          {(attachedImages.length > 0 || attachedFiles.length > 0) && (
            <PromptInputHeader>
              <div className="rounded-xl bg-muted/40 p-2">
                <div className="flex flex-wrap gap-2">
                  {attachedImages.map((file, index) => (
                    <ImageAttachment
                      key={`img-${index}`}
                      file={file}
                      onRemove={() => onRemoveImage(index)}
                      uploadProgress={uploadingImages.get(file.name)}
                      error={imageErrors.get(file.name)}
                    />
                  ))}
                  {attachedFiles.map((file, index) => (
                    <FileAttachment
                      key={`file-${index}`}
                      file={file}
                      onRemove={() => onRemoveFile(index)}
                      error={fileErrors.get(file.name)}
                    />
                  ))}
                </div>
              </div>
            </PromptInputHeader>
          )}

          <input {...getInputProps()} />
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) {
                onFileSelection(Array.from(e.target.files));
                e.target.value = '';
              }
            }}
          />
          <input
            ref={(el) => {
              if (el) {
                el.setAttribute('webkitdirectory', '');
                // eslint-disable-next-line no-param-reassign
                (folderInputRef as { current: HTMLInputElement | null }).current = el;
              }
            }}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) {
                onFileSelection(Array.from(e.target.files));
                e.target.value = '';
              }
            }}
          />

          <PromptInputBody>
            <div ref={inputHighlightRef} aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl">
              <div className="chat-input-placeholder block w-full whitespace-pre-wrap break-words px-4 py-2 text-sm leading-6 text-transparent">
                {renderInputWithMentions(input)}
              </div>
            </div>

            <PromptInputTextarea
              ref={textareaRef}
              value={input}
              onChange={onInputChange}
              onClick={onTextareaClick}
              onKeyDown={onTextareaKeyDown}
              onPaste={onTextareaPaste}
              onScroll={(event) => onTextareaScrollSync(event.target as HTMLTextAreaElement)}
              onFocus={() => onInputFocusChange?.(true)}
              onBlur={() => onInputFocusChange?.(false)}
              onInput={onTextareaInput}
              placeholder={placeholder}
            />
        </PromptInputBody>

        <PromptInputFooter>
          <PromptInputTools>
            <div className="relative">
              <PromptInputButton
                tooltip={{ content: t('input.attachImages', { defaultValue: 'Attach' }) }}
                onClick={() => setShowAttachMenu((v) => !v)}
              >
                <PaperclipIcon />
              </PromptInputButton>
              {showAttachMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowAttachMenu(false)} />
                  <div className="absolute bottom-full left-0 z-50 mb-2 w-40 overflow-hidden rounded-lg border border-border/50 bg-card shadow-lg">
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground hover:bg-accent/50"
                      onClick={() => { openImagePicker(); setShowAttachMenu(false); }}
                    >
                      <ImageIcon className="h-4 w-4" />
                      Image
                    </button>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground hover:bg-accent/50"
                      onClick={() => { openFilePicker(); setShowAttachMenu(false); }}
                    >
                      <FileIcon className="h-4 w-4" />
                      File
                    </button>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground hover:bg-accent/50"
                      onClick={() => { openFolderPicker(); setShowAttachMenu(false); }}
                    >
                      <FolderIcon className="h-4 w-4" />
                      Folder
                    </button>
                  </div>
                </>
              )}
            </div>

            {provider !== 'codex' && (
              <ModePills<PermissionMode>
                ariaLabel="Permission mode"
                selected={permissionMode === 'plan' ? 'plan' : 'bypassPermissions'}
                onSelect={onPermissionModeSelect}
                items={[
                  {
                    id: 'bypassPermissions',
                    label: 'Bypass',
                    title: 'Bypass — skip all permission prompts',
                  },
                  {
                    id: 'plan',
                    label: 'Plan',
                    title: 'Plan — read-only planning, no edits',
                  },
                ]}
              />
            )}

            {provider === 'claude' && (
              <ModePills<string>
                ariaLabel="Reasoning effort"
                selected={thinkingMode}
                onSelect={setThinkingMode}
                items={thinkingModes.map((mode) => ({
                  id: mode.id,
                  label:
                    mode.id === 'medium' ? 'Med'
                    : mode.id === 'xhigh' ? 'xhigh'
                    : mode.name,
                  title: mode.description,
                }))}
              />
            )}

            {provider === 'claude' && (
              <ModelSelector
                claudeModel={claudeModel}
                setClaudeModel={setClaudeModel}
                tokensUsed={tokenBudget?.used || 0}
              />
            )}

            <PromptInputButton
              tooltip={{ content: t('input.showAllCommands') }}
              onClick={onToggleCommandMenu}
              className="relative"
            >
              <MessageSquareIcon />
              {slashCommandsCount > 0 && (
                <span
                  className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground"
                >
                  {slashCommandsCount}
                </span>
              )}
            </PromptInputButton>

            {hasInput && (
              <PromptInputButton
                tooltip={{ content: t('input.clearInput', { defaultValue: 'Clear input' }) }}
                onClick={onClearInput}
                className="hidden sm:No-flex"
              >
                <XIcon />
              </PromptInputButton>
            )}

          </PromptInputTools>

          <div className="flex items-center gap-2">
            <TokenUsagePie
              used={tokenBudget?.used || 0}
              total={
                tokenBudget?.total ||
                (provider === 'claude'
                  ? getClaudeContextWindow(claudeModel)
                  : parseInt(import.meta.env.VITE_CONTEXT_WINDOW) || 1_000_000)
              }
              onClick={provider === 'claude' && onCompact ? onCompact : undefined}
              clickTitle={provider === 'claude' ? 'Click to /compact' : undefined}
            />
            <div
              className={`hidden text-[10px] text-muted-foreground/40 transition-opacity duration-200 lg:block ${
                input.trim() ? 'opacity-0' : 'opacity-100'
              }`}
            >
              {sendByCtrlEnter ? t('input.hintText.ctrlEnter') : t('input.hintText.enter')}
            </div>
            <PromptInputSubmit
              disabled={(!input.trim() && attachedImages.length === 0 && attachedFiles.length === 0) || isLoading}
              className="h-10 w-10 sm:h-10 sm:w-10"
              onMouseDown={(event) => {
                event.preventDefault();
                onSubmit(event as unknown as MouseEvent<HTMLButtonElement>);
              }}
              onTouchStart={(event) => {
                event.preventDefault();
                onSubmit(event as unknown as TouchEvent<HTMLButtonElement>);
              }}
            />
          </div>
        </PromptInputFooter>
      </PromptInput>
      </div>}
    </div>
  );
}
