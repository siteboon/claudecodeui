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
            
            {message.isToolUse && !['Read', 'TodoWrite', 'TodoRead'].includes(message.toolName) ? (
              (() => {
                // Minimize Grep and Glob tools since they happen frequently
                const isSearchTool = ['Grep', 'Glob'].includes(message.toolName);

                if (isSearchTool) {
                  return (
                    <>
                      <div className="group relative bg-gray-50/50 dark:bg-gray-800/30 border-l-2 border-blue-400 dark:border-blue-500 pl-3 py-2 my-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 flex-1 min-w-0">
                            <svg className="w-3.5 h-3.5 text-blue-500 dark:text-blue-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                            <span className="font-medium flex-shrink-0">{message.toolName}</span>
                            <span className="text-gray-400 dark:text-gray-500 flex-shrink-0">•</span>
                            {message.toolInput && (() => {
                              try {
                                const input = JSON.parse(message.toolInput);
                                return (
                                  <span className="font-mono truncate flex-1 min-w-0">
                                    {input.pattern && <span>{t('search.pattern')} <span className="text-blue-600 dark:text-blue-400">{input.pattern}</span></span>}
                                    {input.path && <span className="ml-2">{t('search.in')} {input.path}</span>}
                                  </span>
                                );
                              } catch (e) {
                                return null;
                              }
                            })()}
                          </div>
                          {message.toolResult && (
                            <a
                              href={`#tool-result-${message.toolId}`}
                              className="flex-shrink-0 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium transition-colors flex items-center gap-1"
                            >
                              <span>{t('tools.searchResults')}</span>
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                            </a>
                          )}
                        </div>
                      </div>
                    </>
                  );
                }

                // Full display for other tools
                return (
              <div className="group relative bg-gradient-to-br from-blue-50/50 to-indigo-50/50 dark:from-blue-950/20 dark:to-indigo-950/20 border border-blue-100/30 dark:border-blue-800/30 rounded-lg p-3 mb-2">
                {/* Decorative gradient overlay */}
                <div className="absolute inset-0 bg-gradient-to-br from-blue-500/3 to-indigo-500/3 dark:from-blue-400/3 dark:to-indigo-400/3 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>

                <div className="relative flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="relative w-8 h-8 bg-gradient-to-br from-blue-500 to-indigo-600 dark:from-blue-400 dark:to-indigo-500 rounded-lg flex items-center justify-center shadow-lg shadow-blue-500/20 dark:shadow-blue-400/20">
                      <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      {/* Subtle pulse animation */}
                      <div className="absolute inset-0 rounded-lg bg-blue-500 dark:bg-blue-400 animate-pulse opacity-20"></div>
                    </div>
                    <div className="flex flex-col">
                      <span className="font-semibold text-gray-900 dark:text-white text-sm">
                        {message.toolName}
                      </span>
                      <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                        {message.toolId}
                      </span>
                    </div>
                  </div>
                  {onShowSettings && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onShowSettings();
                      }}
                      className="p-2 rounded-lg hover:bg-white/60 dark:hover:bg-gray-800/60 transition-all duration-200 group/btn backdrop-blur-sm"
                      title={t('tools.settings')}
                    >
                      <svg className="w-4 h-4 text-gray-600 dark:text-gray-400 group-hover/btn:text-blue-600 dark:group-hover/btn:text-blue-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    </button>
                  )}
                </div>
                {message.toolInput && message.toolName === 'Edit' && (() => {
                  try {
                    const input = JSON.parse(message.toolInput);
                    if (input.file_path && input.old_string && input.new_string) {
                      return (
                        <details className="relative mt-3 group/details" open={autoExpandTools}>
                          <summary className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors duration-200 p-2.5 rounded-lg hover:bg-white/50 dark:hover:bg-gray-800/50">
                            <svg className="w-4 h-4 transition-transform duration-200 group-open/details:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                            <span className="flex items-center gap-2">
                              <span>View edit diff for</span>
                            </span> 
                            <button
                              onClick={async (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (!onFileOpen) return;

                                try {
                                  // Fetch the current file (after the edit)
                                  const response = await api.readFile(selectedProject?.name, input.file_path);
                                  const data = await response.json();

                                  if (!response.ok || data.error) {
                                    console.error('Failed to fetch file:', data.error);
                                    onFileOpen(input.file_path);
                                    return;
                                  }

                                  const currentContent = data.content || '';

                                  // Reverse apply the edit: replace new_string back to old_string to get the file BEFORE the edit
                                  const oldContent = currentContent.replace(input.new_string, input.old_string);

                                  // Pass the full file before and after the edit
                                  onFileOpen(input.file_path, {
                                    old_string: oldContent,
                                    new_string: currentContent
                                  });
                                } catch (error) {
                                  console.error('Error preparing diff:', error);
                                  onFileOpen(input.file_path);
                                }
                              }}
                              className="px-2.5 py-1 rounded-md bg-white/60 dark:bg-gray-800/60 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 font-mono text-xs font-medium transition-all duration-200 shadow-sm"
                            >
                              {input.file_path.split('/').pop()}
                            </button>
                          </summary>
                          <div className="mt-3 pl-6">
                            <div className="bg-white dark:bg-gray-900/50 border border-gray-200/60 dark:border-gray-700/60 rounded-lg overflow-hidden shadow-sm">
                              <div className="flex items-center justify-between px-4 py-2.5 bg-gradient-to-r from-gray-50 to-gray-100/50 dark:from-gray-800/80 dark:to-gray-800/40 border-b border-gray-200/60 dark:border-gray-700/60 backdrop-blur-sm">
                                <button
                                  onClick={async () => {
                                    if (!onFileOpen) return;

                                    try {
                                      // Fetch the current file (after the edit)
                                      const response = await api.readFile(selectedProject?.name, input.file_path);
                                      const data = await response.json();

                                      if (!response.ok || data.error) {
                                        console.error('Failed to fetch file:', data.error);
                                        onFileOpen(input.file_path);
                                        return;
                                      }

                                      const currentContent = data.content || '';
                                      // Reverse apply the edit: replace new_string back to old_string
                                      const oldContent = currentContent.replace(input.new_string, input.old_string);

                                      // Pass the full file before and after the edit
                                      onFileOpen(input.file_path, {
                                        old_string: oldContent,
                                        new_string: currentContent
                                      });
                                    } catch (error) {
                                      console.error('Error preparing diff:', error);
                                      onFileOpen(input.file_path);
                                    }
                                  }}
                                  className="text-xs font-mono text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 truncate cursor-pointer font-medium transition-colors"
                                >
                                  {input.file_path}
                                </button>
                                <span className="text-xs text-gray-500 dark:text-gray-400 font-medium px-2 py-0.5 bg-gray-100 dark:bg-gray-700/50 rounded">
                                  Diff
                                </span>
                              </div>
                              <div className="text-xs font-mono">
                                {createDiff(input.old_string, input.new_string).map((diffLine, i) => (
                                  <div key={i} className="flex">
                                    <span className={`w-8 text-center border-r ${
                                      diffLine.type === 'removed' 
                                        ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800'
                                        : 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 border-green-200 dark:border-green-800'
                                    }`}>
                                      {diffLine.type === 'removed' ? '-' : '+'}
                                    </span>
                                    <span className={`px-2 py-0.5 flex-1 whitespace-pre-wrap ${
                                      diffLine.type === 'removed'
                                        ? 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200'
                                        : 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200'
                                    }`}>
                                      {diffLine.content}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                            {showRawParameters && (
                              <details className="relative mt-3 pl-6 group/raw" open={autoExpandTools}>
                                <summary className="flex items-center gap-2 text-xs font-medium text-gray-600 dark:text-gray-400 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors duration-200 p-2 rounded-lg hover:bg-white/50 dark:hover:bg-gray-800/50">
                                  <svg className="w-3 h-3 transition-transform duration-200 group-open/raw:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                  </svg>
                                  View raw parameters
                                </summary>
                                <pre className="mt-2 text-xs bg-gray-50 dark:bg-gray-800/50 border border-gray-200/60 dark:border-gray-700/60 p-3 rounded-lg whitespace-pre-wrap break-words overflow-hidden text-gray-700 dark:text-gray-300 font-mono">
                                  {message.toolInput}
                                </pre>
                              </details>
                            )}
                          </div>
                        </details>
                      );
                    }
                  } catch (e) {
                    // Fall back to raw display if parsing fails
                  }
                  return (
                    <details className="relative mt-3 group/params" open={autoExpandTools}>
                      <summary className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors duration-200 p-2.5 rounded-lg hover:bg-white/50 dark:hover:bg-gray-800/50">
                        <svg className="w-4 h-4 transition-transform duration-200 group-open/params:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                        View input parameters
                      </summary>
                      <pre className="mt-3 text-xs bg-gray-50 dark:bg-gray-800/50 border border-gray-200/60 dark:border-gray-700/60 p-3 rounded-lg whitespace-pre-wrap break-words overflow-hidden text-gray-700 dark:text-gray-300 font-mono">
                        {message.toolInput}
                      </pre>
                    </details>
                  );
                })()}
                {message.toolInput && message.toolName !== 'Edit' && (() => {
                  // Debug log to see what we're dealing with
                  
                  // Special handling for Write tool
                  if (message.toolName === 'Write') {
                    try {
                      let input;
                      // Handle both JSON string and already parsed object
                      if (typeof message.toolInput === 'string') {
                        input = JSON.parse(message.toolInput);
                      } else {
                        input = message.toolInput;
                      }
                      
                      
                      if (input.file_path && input.content !== undefined) {
                        return (
                          <details className="relative mt-3 group/details" open={autoExpandTools}>
                            <summary className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors duration-200 p-2.5 rounded-lg hover:bg-white/50 dark:hover:bg-gray-800/50">
                              <svg className="w-4 h-4 transition-transform duration-200 group-open/details:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                              <span className="flex items-center gap-2">
                                <span className="text-lg leading-none">📄</span>
                                <span>Creating new file:</span>
                              </span>
                              <button
                                onClick={async (e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  if (!onFileOpen) return;

                                  try {
                                    // Fetch the written file from disk
                                    const response = await api.readFile(selectedProject?.name, input.file_path);
                                    const data = await response.json();

                                    const newContent = (response.ok && !data.error) ? data.content || '' : input.content || '';

                                    // New file: old_string is empty, new_string is the full file
                                    onFileOpen(input.file_path, {
                                      old_string: '',
                                      new_string: newContent
                                    });
                                  } catch (error) {
                                    console.error('Error preparing diff:', error);
                                    // Fallback to tool input content
                                    onFileOpen(input.file_path, {
                                      old_string: '',
                                      new_string: input.content || ''
                                    });
                                  }
                                }}
                                className="px-2.5 py-1 rounded-md bg-white/60 dark:bg-gray-800/60 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 font-mono text-xs font-medium transition-all duration-200 shadow-sm"
                              >
                                {input.file_path.split('/').pop()}
                              </button>
                            </summary>
                            <div className="mt-3 pl-6">
                              <div className="bg-white dark:bg-gray-900/50 border border-gray-200/60 dark:border-gray-700/60 rounded-lg overflow-hidden shadow-sm">
                                <div className="flex items-center justify-between px-4 py-2.5 bg-gradient-to-r from-gray-50 to-gray-100/50 dark:from-gray-800/80 dark:to-gray-800/40 border-b border-gray-200/60 dark:border-gray-700/60 backdrop-blur-sm">
                                  <button
                                    onClick={async () => {
                                      if (!onFileOpen) return;

                                      try {
                                        // Fetch the written file from disk
                                        const response = await api.readFile(selectedProject?.name, input.file_path);
                                        const data = await response.json();

                                        const newContent = (response.ok && !data.error) ? data.content || '' : input.content || '';

                                        // New file: old_string is empty, new_string is the full file
                                        onFileOpen(input.file_path, {
                                          old_string: '',
                                          new_string: newContent
                                        });
                                      } catch (error) {
                                        console.error('Error preparing diff:', error);
                                        // Fallback to tool input content
                                        onFileOpen(input.file_path, {
                                          old_string: '',
                                          new_string: input.content || ''
                                        });
                                      }
                                    }}
                                    className="text-xs font-mono text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 truncate cursor-pointer font-medium transition-colors"
                                  >
                                    {input.file_path}
                                  </button>
                                  <span className="text-xs text-gray-500 dark:text-gray-400 font-medium px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded">
                                    New File
                                  </span>
                                </div>
                                <div className="text-xs font-mono">
                                  {createDiff('', input.content).map((diffLine, i) => (
                                    <div key={i} className="flex">
                                      <span className={`w-8 text-center border-r ${
                                        diffLine.type === 'removed' 
                                          ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800'
                                          : 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 border-green-200 dark:border-green-800'
                                      }`}>
                                        {diffLine.type === 'removed' ? '-' : '+'}
                                      </span>
                                      <span className={`px-2 py-0.5 flex-1 whitespace-pre-wrap ${
                                        diffLine.type === 'removed'
                                          ? 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200'
                                          : 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200'
                                      }`}>
                                        {diffLine.content}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                              {showRawParameters && (
                                <details className="relative mt-3 pl-6 group/raw" open={autoExpandTools}>
                                  <summary className="flex items-center gap-2 text-xs font-medium text-gray-600 dark:text-gray-400 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors duration-200 p-2 rounded-lg hover:bg-white/50 dark:hover:bg-gray-800/50">
                                    <svg className="w-3 h-3 transition-transform duration-200 group-open/raw:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                    </svg>
                                    View raw parameters
                                  </summary>
                                  <pre className="mt-2 text-xs bg-gray-50 dark:bg-gray-800/50 border border-gray-200/60 dark:border-gray-700/60 p-3 rounded-lg whitespace-pre-wrap break-words overflow-hidden text-gray-700 dark:text-gray-300 font-mono">
                                    {message.toolInput}
                                  </pre>
                                </details>
                              )}
                            </div>
                          </details>
                        );
                      }
                    } catch (e) {
                      // Fall back to regular display
                    }
                  }
                  
                  // Special handling for TodoWrite tool
                  if (message.toolName === 'TodoWrite') {
                    try {
                      const input = JSON.parse(message.toolInput);
                      if (input.todos && Array.isArray(input.todos)) {
                        return (
                          <details className="relative mt-3 group/todo" open={autoExpandTools}>
                            <summary className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors duration-200 p-2.5 rounded-lg hover:bg-white/50 dark:hover:bg-gray-800/50">
                              <svg className="w-4 h-4 transition-transform duration-200 group-open/todo:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                              <span className="flex items-center gap-2">
                                <span className="text-lg leading-none">✓</span>
                                <span>Updating Todo List</span>
                              </span>
                            </summary>
                            <div className="mt-3">
                              <TodoList todos={input.todos} />
                              {showRawParameters && (
                                <details className="relative mt-3 group/raw" open={autoExpandTools}>
                                  <summary className="flex items-center gap-2 text-xs font-medium text-gray-600 dark:text-gray-400 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors duration-200 p-2 rounded-lg hover:bg-white/50 dark:hover:bg-gray-800/50">
                                    <svg className="w-3 h-3 transition-transform duration-200 group-open/raw:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                    </svg>
                                    View raw parameters
                                  </summary>
                                  <pre className="mt-2 text-xs bg-gray-50 dark:bg-gray-800/50 border border-gray-200/60 dark:border-gray-700/60 p-3 rounded-lg overflow-x-auto text-gray-700 dark:text-gray-300 font-mono">
                                    {message.toolInput}
                                  </pre>
                                </details>
                              )}
                            </div>
                          </details>
                        );
                      }
                    } catch (e) {
                      // Fall back to regular display
                    }
                  }
                  
                  // Special handling for Bash tool
                  if (message.toolName === 'Bash') {
                    try {
                      const input = JSON.parse(message.toolInput);
                      return (
                        <div className="my-2">
                          <div className="bg-gray-900 dark:bg-gray-950 rounded-md px-3 py-2 font-mono text-sm">
                            <span className="text-green-400">$</span>
                            <span className="text-gray-100 ml-2">{input.command}</span>
                          </div>
                          {input.description && (
                            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400 italic ml-1">
                              {input.description}
                            </div>
                          )}
                        </div>
                      );
                    } catch (e) {
                      // Fall back to regular display
                    }
                  }
                  
                  // Special handling for Read tool
                  if (message.toolName === 'Read') {
                    try {
                      const input = JSON.parse(message.toolInput);
                      if (input.file_path) {
                        const filename = input.file_path.split('/').pop();
                        
                        return (
                          <div className="mt-2 text-sm text-blue-700 dark:text-blue-300">
                            Read{' '}
                            <button
                              onClick={() => onFileOpen && onFileOpen(input.file_path)}
                              className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 underline font-mono"
                            >
                              {filename}
                            </button>
                          </div>
                        );
                      }
                    } catch (e) {
                      // Fall back to regular display
                    }
                  }
                  
                  // Special handling for exit_plan_mode tool
                  if (message.toolName === 'exit_plan_mode') {
                    try {
                      const input = JSON.parse(message.toolInput);
                      if (input.plan) {
                        // Replace escaped newlines with actual newlines
                        const planContent = input.plan.replace(/\\n/g, '\n');
                        return (
                          <details className="mt-2" open={autoExpandTools}>
                            <summary className="text-sm text-blue-700 dark:text-blue-300 cursor-pointer hover:text-blue-800 dark:hover:text-blue-200 flex items-center gap-2">
                              <svg className="w-4 h-4 transition-transform details-chevron" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                              📋 View implementation plan
                            </summary>
                            <Markdown className="mt-3 prose prose-sm max-w-none dark:prose-invert">
                              {planContent}
                            </Markdown>
                          </details>
                        );
                      }
                    } catch (e) {
                      // Fall back to regular display
                    }
                  }
                  
                  // Regular tool input display for other tools
                  return (
                    <details className="relative mt-3 group/params" open={autoExpandTools}>
                      <summary className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors duration-200 p-2.5 rounded-lg hover:bg-white/50 dark:hover:bg-gray-800/50">
                        <svg className="w-4 h-4 transition-transform duration-200 group-open/params:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                        View input parameters
                      </summary>
                      <pre className="mt-3 text-xs bg-gray-50 dark:bg-gray-800/50 border border-gray-200/60 dark:border-gray-700/60 p-3 rounded-lg whitespace-pre-wrap break-words overflow-hidden text-gray-700 dark:text-gray-300 font-mono">
                        {message.toolInput}
                      </pre>
                    </details>
                  );
                })()}
                
                {/* Tool Result Section */}
                {message.toolResult && (() => {
                  // Hide tool results for Edit/Write/Bash unless there's an error
                  const shouldHideResult = !message.toolResult.isError &&
                    (message.toolName === 'Edit' || message.toolName === 'Write' || message.toolName === 'ApplyPatch' || message.toolName === 'Bash');

                  if (shouldHideResult) {
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
                            // The content should be JSON with a "plan" field
                            const parsed = JSON.parse(content);
                            if (parsed.plan) {
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
              </div>
                );
              })()
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
            ) : message.isToolUse && message.toolName === 'Read' ? (
              // Simple Read tool indicator
              (() => {
                try {
                  const input = JSON.parse(message.toolInput);
                  if (input.file_path) {
                    const filename = input.file_path.split('/').pop();
                    return (
                      <div className="bg-gray-50/50 dark:bg-gray-800/30 border-l-2 border-gray-400 dark:border-gray-500 pl-3 py-2 my-2">
                        <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                          <svg className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                          </svg>
                          <span className="font-medium">Read</span>
                          <button
                            onClick={() => onFileOpen && onFileOpen(input.file_path)}
                            className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-mono transition-colors"
                          >
                            {filename}
                          </button>
                        </div>
                      </div>
                    );
                  }
                } catch (e) {
                  return (
                    <div className="bg-gray-50/50 dark:bg-gray-800/30 border-l-2 border-gray-400 dark:border-gray-500 pl-3 py-2 my-2">
                      <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                        <svg className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                        </svg>
                        <span className="font-medium">Read file</span>
                      </div>
                    </div>
                  );
                }
              })()
            ) : message.isToolUse && message.toolName === 'TodoWrite' ? (
              // Simple TodoWrite tool indicator with tasks
              (() => {
                try {
                  const input = JSON.parse(message.toolInput);
                  if (input.todos && Array.isArray(input.todos)) {
                    return (
                      <div className="bg-gray-50/50 dark:bg-gray-800/30 border-l-2 border-gray-400 dark:border-gray-500 pl-3 py-2 my-2">
                        <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 mb-2">
                          <svg className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                          </svg>
                          <span className="font-medium">Update todo list</span>
                        </div>
                        <TodoList todos={input.todos} />
                      </div>
                    );
                  }
                } catch (e) {
                  return (
                    <div className="bg-gray-50/50 dark:bg-gray-800/30 border-l-2 border-gray-400 dark:border-gray-500 pl-3 py-2 my-2">
                      <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                        <svg className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                        </svg>
                        <span className="font-medium">Update todo list</span>
                      </div>
                    </div>
                  );
                }
              })()
            ) : message.isToolUse && message.toolName === 'TodoRead' ? (
              // Simple TodoRead tool indicator
              <div className="bg-gray-50/50 dark:bg-gray-800/30 border-l-2 border-gray-400 dark:border-gray-500 pl-3 py-2 my-2">
                <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                  <svg className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  <span className="font-medium">Read todo list</span>
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


