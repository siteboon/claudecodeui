// @ts-nocheck
import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';
import TodoList from '../../TodoList';
import ClaudeLogo from '../../ClaudeLogo.jsx';
import CursorLogo from '../../CursorLogo.jsx';
import CodexLogo from '../../CodexLogo.jsx';
import { api, authenticatedFetch } from '../../../utils/api';
import type { ChatMessage, Provider } from '../types';
import { Markdown } from '../markdown/Markdown';
import { formatUsageLimitText } from '../utils/chatFormatting';
import { getClaudePermissionSuggestion } from '../utils/chatPermissions';
import type { Project } from '../../../types/app';
import { ToolRenderer, shouldHideToolResult } from '../tools';

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
  onFileOpen?: (filePath: string, diffInfo?: any) => void;
  onShowSettings?: () => void;
  onGrantToolPermission?: (suggestion: any) => any;
  autoExpandTools?: boolean;
  showRawParameters?: boolean;
  showThinking?: boolean;
  selectedProject?: Project | null;
  provider: Provider | string;
}

const MessageComponent = memo(({ message, index, prevMessage, createDiff, onFileOpen, onShowSettings, onGrantToolPermission, autoExpandTools, showRawParameters, showThinking, selectedProject, provider }: MessageComponentProps) => {
  const { t } = useTranslation('chat');
  const isGrouped = prevMessage && prevMessage.type === message.type &&
                   ((prevMessage.type === 'assistant') ||
                    (prevMessage.type === 'user') ||
                    (prevMessage.type === 'tool') ||
                    (prevMessage.type === 'error'));
  const messageRef = React.useRef(null);
  const [isExpanded, setIsExpanded] = React.useState(false);
  const permissionSuggestion = getClaudePermissionSuggestion(message, provider);
  const [permissionGrantState, setPermissionGrantState] = React.useState('idle');


  React.useEffect(() => {
    setPermissionGrantState('idle');
  }, [permissionSuggestion?.entry, message.toolId]);

  React.useEffect(() => {
    if (!autoExpandTools || !messageRef.current || !message.isToolUse) return;
    
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !isExpanded) {
            setIsExpanded(true);
            // Find all details elements and open them
            const details = messageRef.current.querySelectorAll('details');
            details.forEach(detail => {
              detail.open = true;
            });
          }
        });
      },
      { threshold: 0.1 }
    );
    
    observer.observe(messageRef.current);
    
    return () => {
      if (messageRef.current) {
        observer.unobserve(messageRef.current);
      }
    };
  }, [autoExpandTools, isExpanded, message.isToolUse]);

  return (
    <div
      ref={messageRef}
      className={`chat-message ${message.type} ${isGrouped ? 'grouped' : ''} ${message.type === 'user' ? 'flex justify-end px-3 sm:px-0' : 'px-3 sm:px-0'}`}
    >
      {message.type === 'user' ? (
        /* User message bubble on the right */
        <div className="flex items-end space-x-0 sm:space-x-3 w-full sm:w-auto sm:max-w-[85%] md:max-w-md lg:max-w-lg xl:max-w-xl">
          <div className="bg-blue-600 text-white rounded-2xl rounded-br-md px-3 sm:px-4 py-2 shadow-sm flex-1 sm:flex-initial">
            <div className="text-sm whitespace-pre-wrap break-words">
              {message.content}
            </div>
            {message.images && message.images.length > 0 && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                {message.images.map((img, idx) => (
                  <img
                    key={idx}
                    src={img.data}
                    alt={img.name}
                    className="rounded-lg max-w-full h-auto cursor-pointer hover:opacity-90 transition-opacity"
                    onClick={() => window.open(img.data, '_blank')}
                  />
                ))}
              </div>
            )}
            <div className="text-xs text-blue-100 mt-1 text-right">
              {new Date(message.timestamp).toLocaleTimeString()}
            </div>
          </div>
          {!isGrouped && (
            <div className="hidden sm:flex w-8 h-8 bg-blue-600 rounded-full items-center justify-center text-white text-sm flex-shrink-0">
              U
            </div>
          )}
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
                  {(localStorage.getItem('selected-provider') || 'claude') === 'cursor' ? (
                    <CursorLogo className="w-full h-full" />
                  ) : (localStorage.getItem('selected-provider') || 'claude') === 'codex' ? (
                    <CodexLogo className="w-full h-full" />
                  ) : (
                    <ClaudeLogo className="w-full h-full" />
                  )}
                </div>
              )}
              <div className="text-sm font-medium text-gray-900 dark:text-white">
                {message.type === 'error' ? t('messageTypes.error') : message.type === 'tool' ? t('messageTypes.tool') : ((localStorage.getItem('selected-provider') || 'claude') === 'cursor' ? t('messageTypes.cursor') : (localStorage.getItem('selected-provider') || 'claude') === 'codex' ? t('messageTypes.codex') : t('messageTypes.claude'))}
              </div>
            </div>
          )}
          
          <div className="w-full">

            {message.isToolUse ? (
              <>
                <div className="flex flex-col">
                  <div className="flex flex-col">
                    <Markdown className="prose prose-sm max-w-none dark:prose-invert">{message.displayText}</Markdown>
                  </div>
                </div>

                {message.toolInput && (
                  <ToolRenderer
                    toolName={message.toolName}
                    toolInput={message.toolInput}
                    toolResult={message.toolResult}
                    toolId={message.toolId}
                    mode="input"
                    onFileOpen={onFileOpen}
                    createDiff={createDiff}
                    selectedProject={selectedProject}
                    autoExpandTools={autoExpandTools}
                    showRawParameters={showRawParameters}
                    onShowSettings={onShowSettings}
                    rawToolInput={message.toolInput}
                  />
                )}
                
                {/* Tool Result Section */}
                {message.toolResult && (() => {
                  // Use config to determine if result should be hidden
                  if (shouldHideToolResult(message.toolName, message.toolResult)) {
                    return null;
                  }

                  return (
                  <div
                    id={`tool-result-${message.toolId}`}
                    className={`relative mt-4 p-4 rounded-lg border backdrop-blur-sm scroll-mt-4 ${
                    message.toolResult.isError
                      ? 'bg-gradient-to-br from-red-50 to-rose-50 dark:from-red-950/20 dark:to-rose-950/20 border-red-200/60 dark:border-red-800/60'
                      : 'bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950/20 dark:to-emerald-950/20 border-green-200/60 dark:border-green-800/60'
                  }`}>
                    {/* Decorative gradient overlay */}
                    <div className={`absolute inset-0 rounded-lg opacity-50 ${
                      message.toolResult.isError
                        ? 'bg-gradient-to-br from-red-500/5 to-rose-500/5 dark:from-red-400/5 dark:to-rose-400/5'
                        : 'bg-gradient-to-br from-green-500/5 to-emerald-500/5 dark:from-green-400/5 dark:to-emerald-400/5'
                    }`}></div>

                    <div className="relative flex items-center gap-2.5 mb-3">
                      <div className={`w-6 h-6 rounded-lg flex items-center justify-center shadow-md ${
                        message.toolResult.isError
                          ? 'bg-gradient-to-br from-red-500 to-rose-600 dark:from-red-400 dark:to-rose-500 shadow-red-500/20'
                          : 'bg-gradient-to-br from-green-500 to-emerald-600 dark:from-green-400 dark:to-emerald-500 shadow-green-500/20'
                      }`}>
                        <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          {message.toolResult.isError ? (
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                          ) : (
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                          )}
                        </svg>
                      </div>
                      <span className={`text-sm font-semibold ${
                        message.toolResult.isError
                          ? 'text-red-800 dark:text-red-200'
                          : 'text-green-800 dark:text-green-200'
                      }`}>
                        {message.toolResult.isError ? 'Tool Error' : 'Tool Result'}
                      </span>
                    </div>

                    <div className={`relative text-sm ${
                      message.toolResult.isError
                        ? 'text-red-900 dark:text-red-100'
                        : 'text-green-900 dark:text-green-100'
                    }`}>
                      {(() => {
                        const content = String(message.toolResult.content || '');
                        
                        // Special handling for TodoWrite/TodoRead results
                        if ((message.toolName === 'TodoWrite' || message.toolName === 'TodoRead') &&
                            (content.includes('Todos have been modified successfully') || 
                             content.includes('Todo list') || 
                             (content.startsWith('[') && content.includes('"content"') && content.includes('"status"')))) {
                          try {
                            // Try to parse if it looks like todo JSON data
                            let todos = null;
                            if (content.startsWith('[')) {
                              todos = JSON.parse(content);
                            } else if (content.includes('Todos have been modified successfully')) {
                              // For TodoWrite success messages, we don't have the data in the result
                              return (
                                <div>
                                  <div className="flex items-center gap-2 mb-2">
                                    <span className="font-medium">Todo list has been updated successfully</span>
                                  </div>
                                </div>
                              );
                            }
                            
                            if (todos && Array.isArray(todos)) {
                              return (
                                <div>
                                  <div className="flex items-center gap-2 mb-3">
                                    <span className="font-medium">Current Todo List</span>
                                  </div>
                                  <TodoList todos={todos} isResult={true} />
                                </div>
                              );
                            }
                          } catch (e) {
                            // Fall through to regular handling
                          }
                        }

                        // Special handling for exit_plan_mode tool results
                        if (message.toolName === 'exit_plan_mode') {
                          try {
                            // Content might already be an object or a JSON string
                            let parsed;
                            if (typeof message.toolResult.content === 'object' && message.toolResult.content !== null) {
                              parsed = message.toolResult.content;
                            } else {
                              parsed = JSON.parse(content);
                            }

                            if (parsed && parsed.plan) {
                              // Replace escaped newlines with actual newlines
                              const planContent = parsed.plan.replace(/\\n/g, '\n');
                              return (
                                <div>
                                  <div className="flex items-center gap-2 mb-3">
                                    <span className="font-medium">Implementation Plan</span>
                                  </div>
                                  <Markdown className="prose prose-sm max-w-none dark:prose-invert">
                                    {planContent}
                                  </Markdown>
                                </div>
                              );
                            }
                          } catch (e) {
                            console.error('Failed to parse exit_plan_mode result:', e);
                            // Fall through to regular handling
                          }
                        }

                        // Special handling for Grep/Glob results with structured data
                        if ((message.toolName === 'Grep' || message.toolName === 'Glob') && message.toolResult?.toolUseResult) {
                          const toolData = message.toolResult.toolUseResult;

                          // Handle files_with_matches mode or any tool result with filenames array
                          if (toolData.filenames && Array.isArray(toolData.filenames) && toolData.filenames.length > 0) {
                            return (
                              <div>
                                <div className="flex items-center gap-2 mb-3">
                                  <span className="font-medium">
                                    Found {toolData.numFiles || toolData.filenames.length} {(toolData.numFiles === 1 || toolData.filenames.length === 1) ? 'file' : 'files'}
                                  </span>
                                </div>
                                <div className="space-y-1 max-h-96 overflow-y-auto">
                                  {toolData.filenames.map((filePath, index) => {
                                    const fileName = filePath.split('/').pop();
                                    const dirPath = filePath.substring(0, filePath.lastIndexOf('/'));

                                    return (
                                      <div
                                        key={index}
                                        onClick={() => {
                                          if (onFileOpen) {
                                            onFileOpen(filePath);
                                          }
                                        }}
                                        className="group flex items-center gap-2 px-2 py-1.5 rounded hover:bg-green-100/50 dark:hover:bg-green-800/20 cursor-pointer transition-colors"
                                      >
                                        <svg className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                        </svg>
                                        <div className="flex-1 min-w-0">
                                          <div className="font-mono text-sm font-medium text-green-800 dark:text-green-200 truncate group-hover:text-green-900 dark:group-hover:text-green-100">
                                            {fileName}
                                          </div>
                                          <div className="font-mono text-xs text-green-600/70 dark:text-green-400/70 truncate">
                                            {dirPath}
                                          </div>
                                        </div>
                                        <svg className="w-4 h-4 text-green-600 dark:text-green-400 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                        </svg>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          }
                        }

                        // Special handling for interactive prompts
                        if (content.includes('Do you want to proceed?') && message.toolName === 'Bash') {
                          const lines = content.split('\n');
                          const promptIndex = lines.findIndex(line => line.includes('Do you want to proceed?'));
                          const beforePrompt = lines.slice(0, promptIndex).join('\n');
                          const promptLines = lines.slice(promptIndex);
                          
                          // Extract the question and options
                          const questionLine = promptLines.find(line => line.includes('Do you want to proceed?')) || '';
                          const options = [];
                          
                          // Parse numbered options (1. Yes, 2. No, etc.)
                          promptLines.forEach(line => {
                            const optionMatch = line.match(/^\s*(\d+)\.\s+(.+)$/);
                            if (optionMatch) {
                              options.push({
                                number: optionMatch[1],
                                text: optionMatch[2].trim()
                              });
                            }
                          });
                          
                          // Find which option was selected (usually indicated by "> 1" or similar)
                          const selectedMatch = content.match(/>\s*(\d+)/);
                          const selectedOption = selectedMatch ? selectedMatch[1] : null;
                          
                          return (
                            <div className="space-y-3">
                              {beforePrompt && (
                                <div className="bg-gray-900 dark:bg-gray-950 text-gray-100 rounded-lg p-3 font-mono text-xs overflow-x-auto">
                                  <pre className="whitespace-pre-wrap break-words">{beforePrompt}</pre>
                                </div>
                              )}
                              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
                                <div className="flex items-start gap-3">
                                  <div className="w-8 h-8 bg-amber-500 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                  </div>
                                  <div className="flex-1">
                                    <h4 className="font-semibold text-amber-900 dark:text-amber-100 text-base mb-2">
                                      Interactive Prompt
                                    </h4>
                                    <p className="text-sm text-amber-800 dark:text-amber-200 mb-4">
                                      {questionLine}
                                    </p>
                                    
                                    {/* Option buttons */}
                                    <div className="space-y-2 mb-4">
                                      {options.map((option) => (
                                        <button
                                          key={option.number}
                                          className={`w-full text-left px-4 py-3 rounded-lg border-2 transition-all ${
                                            selectedOption === option.number
                                              ? 'bg-amber-600 dark:bg-amber-700 text-white border-amber-600 dark:border-amber-700 shadow-md'
                                              : 'bg-white dark:bg-gray-800 text-amber-900 dark:text-amber-100 border-amber-300 dark:border-amber-700 hover:border-amber-400 dark:hover:border-amber-600 hover:shadow-sm'
                                          } ${
                                            selectedOption ? 'cursor-default' : 'cursor-not-allowed opacity-75'
                                          }`}
                                          disabled
                                        >
                                          <div className="flex items-center gap-3">
                                            <span className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                                              selectedOption === option.number
                                                ? 'bg-white/20'
                                                : 'bg-amber-100 dark:bg-amber-800/50'
                                            }`}>
                                              {option.number}
                                            </span>
                                            <span className="text-sm sm:text-base font-medium flex-1">
                                              {option.text}
                                            </span>
                                            {selectedOption === option.number && (
                                              <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                              </svg>
                                            )}
                                          </div>
                                        </button>
                                      ))}
                                    </div>
                                    
                                    {selectedOption && (
                                      <div className="bg-amber-100 dark:bg-amber-800/30 rounded-lg p-3">
                                        <p className="text-amber-900 dark:text-amber-100 text-sm font-medium mb-1">
                                          ✓ Claude selected option {selectedOption}
                                        </p>
                                        <p className="text-amber-800 dark:text-amber-200 text-xs">
                                          In the CLI, you would select this option interactively using arrow keys or by typing the number.
                                        </p>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        }
                        
                        const fileEditMatch = content.match(/The file (.+?) has been updated\./);
                        if (fileEditMatch) {
                          return (
                            <div>
                              <div className="flex items-center gap-2 mb-2">
                                <span className="font-medium">File updated successfully</span>
                              </div>
                              <button
                                onClick={async () => {
                                  if (!onFileOpen) return;

                                  // Fetch FULL file content with diff from git
                                  try {
                                    const response = await authenticatedFetch(`/api/git/file-with-diff?project=${encodeURIComponent(selectedProject?.name)}&file=${encodeURIComponent(fileEditMatch[1])}`);
                                    const data = await response.json();

                                    if (!data.error && data.oldContent !== undefined && data.currentContent !== undefined) {
                                      onFileOpen(fileEditMatch[1], {
                                        old_string: data.oldContent || '',
                                        new_string: data.currentContent || ''
                                      });
                                    } else {
                                      onFileOpen(fileEditMatch[1]);
                                    }
                                  } catch (error) {
                                    console.error('Error fetching file diff:', error);
                                    onFileOpen(fileEditMatch[1]);
                                  }
                                }}
                                className="text-xs font-mono bg-green-100 dark:bg-green-800/30 px-2 py-1 rounded text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 underline cursor-pointer"
                              >
                                {fileEditMatch[1]}
                              </button>
                            </div>
                          );
                        }
                        
                        // Handle Write tool output for file creation
                        const fileCreateMatch = content.match(/(?:The file|File) (.+?) has been (?:created|written)(?: successfully)?\.?/);
                        if (fileCreateMatch) {
                          return (
                            <div>
                              <div className="flex items-center gap-2 mb-2">
                                <span className="font-medium">File created successfully</span>
                              </div>
                              <button
                                onClick={async () => {
                                  if (!onFileOpen) return;

                                  // Fetch FULL file content with diff from git
                                  try {
                                    const response = await authenticatedFetch(`/api/git/file-with-diff?project=${encodeURIComponent(selectedProject?.name)}&file=${encodeURIComponent(fileCreateMatch[1])}`);
                                    const data = await response.json();

                                    if (!data.error && data.oldContent !== undefined && data.currentContent !== undefined) {
                                      onFileOpen(fileCreateMatch[1], {
                                        old_string: data.oldContent || '',
                                        new_string: data.currentContent || ''
                                      });
                                    } else {
                                      onFileOpen(fileCreateMatch[1]);
                                    }
                                  } catch (error) {
                                    console.error('Error fetching file diff:', error);
                                    onFileOpen(fileCreateMatch[1]);
                                  }
                                }}
                                className="text-xs font-mono bg-green-100 dark:bg-green-800/30 px-2 py-1 rounded text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 underline cursor-pointer"
                              >
                                {fileCreateMatch[1]}
                              </button>
                            </div>
                          );
                        }
                        
                        // Special handling for Write tool - hide content if it's just the file content
                        if (message.toolName === 'Write' && !message.toolResult.isError) {
                          // For Write tool, the diff is already shown in the tool input section
                          // So we just show a success message here
                          return (
                            <div className="text-green-700 dark:text-green-300">
                              <div className="flex items-center gap-2">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <span className="font-medium">File written successfully</span>
                              </div>
                              <p className="text-xs mt-1 text-green-600 dark:text-green-400">
                                The file content is displayed in the diff view above
                              </p>
                            </div>
                          );
                        }
                        
                        if (content.includes('cat -n') && content.includes('→')) {
                          return (
                            <details open={autoExpandTools}>
                              <summary className="text-sm text-green-700 dark:text-green-300 cursor-pointer hover:text-green-800 dark:hover:text-green-200 mb-2 flex items-center gap-2">
                                <svg className="w-4 h-4 transition-transform details-chevron" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                                View file content
                              </summary>
                              <div className="mt-2 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                                <div className="text-xs font-mono p-3 whitespace-pre-wrap break-words overflow-hidden">
                                  {content}
                                </div>
                              </div>
                            </details>
                          );
                        }
                        
                        if (content.length > 300) {
                          return (
                            <details open={autoExpandTools}>
                              <summary className="text-sm text-green-700 dark:text-green-300 cursor-pointer hover:text-green-800 dark:hover:text-green-200 mb-2 flex items-center gap-2">
                                <svg className="w-4 h-4 transition-transform details-chevron" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                                View full output ({content.length} chars)
                              </summary>
                              <Markdown className="mt-2 prose prose-sm max-w-none prose-green dark:prose-invert">
                                {content}
                              </Markdown>
                            </details>
                          );
                        }
                        
                        return (
                          <Markdown className="prose prose-sm max-w-none prose-green dark:prose-invert">
                            {content}
                          </Markdown>
                        );
                      })()}
                      {permissionSuggestion && (
                        <div className="mt-4 border-t border-red-200/60 dark:border-red-800/60 pt-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                if (!onGrantToolPermission) return;
                                const result = onGrantToolPermission(permissionSuggestion);
                                if (result?.success) {
                                  setPermissionGrantState('granted');
                                } else {
                                  setPermissionGrantState('error');
                                }
                              }}
                              disabled={permissionSuggestion.isAllowed || permissionGrantState === 'granted'}
                              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                                permissionSuggestion.isAllowed || permissionGrantState === 'granted'
                                  ? 'bg-green-100 dark:bg-green-900/30 border-green-300/70 dark:border-green-800/60 text-green-800 dark:text-green-200 cursor-default'
                                  : 'bg-white/80 dark:bg-gray-900/40 border-red-300/70 dark:border-red-800/60 text-red-700 dark:text-red-200 hover:bg-white dark:hover:bg-gray-900/70'
                              }`}
                            >
                              {permissionSuggestion.isAllowed || permissionGrantState === 'granted'
                                ? 'Permission added'
                                : `Grant permission for ${permissionSuggestion.toolName}`}
                            </button>
                            {onShowSettings && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onShowSettings();
                                }}
                                className="text-xs text-red-700 dark:text-red-200 underline hover:text-red-800 dark:hover:text-red-100"
                              >
                                Open settings
                              </button>
                            )}
                          </div>
                          <div className="mt-2 text-xs text-red-700/90 dark:text-red-200/80">
                            Adds <span className="font-mono">{permissionSuggestion.entry}</span> to Allowed Tools.
                          </div>
                          {permissionGrantState === 'error' && (
                            <div className="mt-2 text-xs text-red-700 dark:text-red-200">
                              Unable to update permissions. Please try again.
                            </div>
                          )}
                          {(permissionSuggestion.isAllowed || permissionGrantState === 'granted') && (
                            <div className="mt-2 text-xs text-green-700 dark:text-green-200">
                              Permission saved. Retry the request to use the tool.
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  );
                })()}
              </>
            ) : message.isInteractivePrompt ? (
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
                      Interactive Prompt
                    </h4>
                    {(() => {
                      const lines = message.content.split('\n').filter(line => line.trim());
                      const questionLine = lines.find(line => line.includes('?')) || lines[0] || '';
                      const options = [];
                      
                      // Parse the menu options
                      lines.forEach(line => {
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
                                className={`w-full text-left px-4 py-3 rounded-lg border-2 transition-all ${
                                  option.isSelected
                                    ? 'bg-amber-600 dark:bg-amber-700 text-white border-amber-600 dark:border-amber-700 shadow-md'
                                    : 'bg-white dark:bg-gray-800 text-amber-900 dark:text-amber-100 border-amber-300 dark:border-amber-700'
                                } cursor-not-allowed opacity-75`}
                                disabled
                              >
                                <div className="flex items-center gap-3">
                                  <span className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                                    option.isSelected
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
                              ⏳ Waiting for your response in the CLI
                            </p>
                            <p className="text-amber-800 dark:text-amber-200 text-xs">
                              Please select an option in your terminal where Claude is running.
                            </p>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>
            ) : message.isThinking ? (
              /* Thinking messages - collapsible by default */
              <div className="text-sm text-gray-700 dark:text-gray-300">
                <details className="group">
                  <summary className="cursor-pointer text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 font-medium flex items-center gap-2">
                    <svg className="w-3 h-3 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    <span>💭 Thinking...</span>
                  </summary>
                  <div className="mt-2 pl-4 border-l-2 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 text-sm">
                    <Markdown className="prose prose-sm max-w-none dark:prose-invert prose-gray">
                      {message.content}
                    </Markdown>
                  </div>
                </details>
              </div>
            ) : (
              <div className="text-sm text-gray-700 dark:text-gray-300">
                {/* Thinking accordion for reasoning */}
                {showThinking && message.reasoning && (
                  <details className="mb-3">
                    <summary className="cursor-pointer text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 font-medium">
                      💭 Thinking...
                    </summary>
                    <div className="mt-2 pl-4 border-l-2 border-gray-300 dark:border-gray-600 italic text-gray-600 dark:text-gray-400 text-sm">
                      <div className="whitespace-pre-wrap">
                        {message.reasoning}
                      </div>
                    </div>
                  </details>
                )}

                {(() => {
                  const content = formatUsageLimitText(String(message.content || ''));

                  // Detect if content is pure JSON (starts with { or [)
                  const trimmedContent = content.trim();
                  if ((trimmedContent.startsWith('{') || trimmedContent.startsWith('[')) &&
                      (trimmedContent.endsWith('}') || trimmedContent.endsWith(']'))) {
                    try {
                      const parsed = JSON.parse(trimmedContent);
                      const formatted = JSON.stringify(parsed, null, 2);

                      return (
                        <div className="my-2">
                          <div className="flex items-center gap-2 mb-2 text-sm text-gray-600 dark:text-gray-400">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                            </svg>
                            <span className="font-medium">JSON Response</span>
                          </div>
                          <div className="bg-gray-800 dark:bg-gray-900 border border-gray-600/30 dark:border-gray-700 rounded-lg overflow-hidden">
                            <pre className="p-4 overflow-x-auto">
                              <code className="text-gray-100 dark:text-gray-200 text-sm font-mono block whitespace-pre">
                                {formatted}
                              </code>
                            </pre>
                          </div>
                        </div>
                      );
                    } catch (e) {
                      // Not valid JSON, fall through to normal rendering
                    }
                  }

                  // Normal rendering for non-JSON content
                  return message.type === 'assistant' ? (
                    <Markdown className="prose prose-sm max-w-none dark:prose-invert prose-gray">
                      {content}
                    </Markdown>
                  ) : (
                    <div className="whitespace-pre-wrap">
                      {content}
                    </div>
                  );
                })()}
              </div>
            )}
            
            <div className={`text-xs text-gray-500 dark:text-gray-400 mt-1 ${isGrouped ? 'opacity-0 group-hover:opacity-100' : ''}`}>
              {new Date(message.timestamp).toLocaleTimeString()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export default MessageComponent;


