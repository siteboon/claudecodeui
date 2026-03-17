import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { CircleHelp, Search, X } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';
import { Prompt, PromptType } from '../types/types';
import PromptCard from './PromptCard';

interface PromptLibraryProps {
  isOpen: boolean;
  onClose: () => void;
  prompts: Prompt[];
  loading: boolean;
  error?: string | null;
  onApplyRole: (prompt: Prompt) => void;
  onInsertTemplate: (prompt: Prompt) => void;
}

export default function PromptLibrary({
  isOpen,
  onClose,
  prompts,
  loading,
  error,
  onApplyRole,
  onInsertTemplate
}: PromptLibraryProps) {
  const { t } = useTranslation('chat');
  const modalRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const [activeTab, setActiveTab] = useState<PromptType>('role');
  const [searchQuery, setSearchQuery] = useState('');
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    const modalElement = modalRef.current;
    if (!modalElement) {
      return;
    }

    const focusableSelectors = [
      'a[href]',
      'button:not([disabled])',
      'textarea:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      '[tabindex]:not([tabindex="-1"])'
    ].join(',');

    const getFocusableElements = () =>
      Array.from(modalElement.querySelectorAll<HTMLElement>(focusableSelectors))
        .filter((element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true');

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const focusableElements = getFocusableElements();
      if (focusableElements.length === 0) {
        event.preventDefault();
        titleRef.current?.focus();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      const currentActive = document.activeElement;

      if (event.shiftKey && currentActive === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && currentActive === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    titleRef.current?.focus();

    modalElement.addEventListener('keydown', handleKeyDown);

    return () => {
      modalElement.removeEventListener('keydown', handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [isOpen, onClose]);

  const filteredPrompts = useMemo(() => {
    return prompts.filter(prompt => {
      const matchesTab = prompt.type === activeTab;
      const matchesSearch = searchQuery === '' ||
        prompt.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        prompt.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        prompt.tags?.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()));

      return matchesTab && matchesSearch;
    });
  }, [prompts, activeTab, searchQuery]);

  const groupedPrompts = useMemo(() => {
    const groups: Record<string, Prompt[]> = {};
    filteredPrompts.forEach(prompt => {
      const category = prompt.category || 'custom';
      if (!groups[category]) {
        groups[category] = [];
      }
      groups[category].push(prompt);
    });
    return groups;
  }, [filteredPrompts]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[80vh] w-full max-w-4xl flex-col rounded-lg bg-white shadow-xl dark:bg-gray-900"
      >
        <div className="relative flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
          <div>
            <h2
              id={titleId}
              ref={titleRef}
              tabIndex={-1}
              className="text-xl font-semibold text-gray-900 outline-none dark:text-gray-100"
            >
              {t('promptLibrary.title')}
            </h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {t('promptLibrary.subtitle')}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowHelp((previous) => !previous)}
              className="inline-flex items-center gap-2 rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              title={t('promptLibrary.helpButtonTitle')}
            >
              <CircleHelp className="h-4 w-4" />
              {t('promptLibrary.helpButton')}
            </button>
            <button type="button" onClick={onClose} className="rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-800">
              <X className="h-5 w-5" />
            </button>
          </div>

          {showHelp && (
            <div className="absolute right-14 top-16 z-10 w-[min(32rem,calc(100vw-3rem))] rounded-xl border border-blue-100 bg-white p-4 shadow-2xl dark:border-blue-900/40 dark:bg-gray-950">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-gray-900 dark:text-gray-100">
                    {t('promptLibrary.helpTitle')}
                  </p>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    {t('promptLibrary.helpDescription')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowHelp(false)}
                  className="rounded p-1 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
                  title={t('promptLibrary.helpClose')}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-3 text-sm text-gray-700 dark:text-gray-200">
                <p>
                  <Trans
                    ns="chat"
                    i18nKey="promptLibrary.helpPaths"
                    components={[<code key="global" />, <code key="project" />]}
                  />
                </p>
                <p>
                  <Trans
                    ns="chat"
                    i18nKey="promptLibrary.helpTypes"
                    components={[<code key="role" />, <code key="template" />]}
                  />
                </p>
                <pre className="overflow-x-auto rounded-md bg-gray-50 p-3 text-xs text-gray-800 dark:bg-gray-900 dark:text-gray-200"><code>{`---
name: My Custom Prompt
type: role
category: custom
description: Helps with a specific workflow
icon: Star
tags: [custom, workflow]
---

Your reusable prompt content goes here.`}</code></pre>
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-4 border-b border-gray-200 px-4 pt-4 dark:border-gray-700">
          <button
            type="button"
            onClick={() => setActiveTab('role')}
            className={`px-1 pb-2 font-medium ${
              activeTab === 'role'
                ? 'border-b-2 border-blue-600 text-blue-600 dark:text-blue-400'
                : 'text-gray-600 dark:text-gray-400'
            }`}
          >
            {t('promptLibrary.tabs.roles')}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('template')}
            className={`px-1 pb-2 font-medium ${
              activeTab === 'template'
                ? 'border-b-2 border-blue-600 text-blue-600 dark:text-blue-400'
                : 'text-gray-600 dark:text-gray-400'
            }`}
          >
            {t('promptLibrary.tabs.templates')}
          </button>
        </div>

        <div className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 transform text-gray-400" />
            <input
              type="text"
              placeholder={t('promptLibrary.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-10 pr-4 dark:border-gray-600 dark:bg-gray-800"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="py-8 text-center">{t('promptLibrary.loading')}</div>
          ) : error ? (
            <div className="py-8 text-center">
              <div className="mb-2 text-red-600 dark:text-red-400">{t('promptLibrary.loadError')}</div>
              <div className="text-sm text-gray-600 dark:text-gray-400">{error}</div>
            </div>
          ) : Object.keys(groupedPrompts).length === 0 ? (
            <div className="py-8 text-center">{t('promptLibrary.empty')}</div>
          ) : (
            <div className="space-y-6">
              {Object.entries(groupedPrompts).map(([category, categoryPrompts]) => (
                <div key={category}>
                  <h3 className="mb-3 text-sm font-semibold uppercase">{category}</h3>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {categoryPrompts.map((prompt) => (
                      <PromptCard
                        key={prompt.path}
                        prompt={prompt}
                        onApply={activeTab === 'role' ? onApplyRole : undefined}
                        onInsert={activeTab === 'template' ? onInsertTemplate : undefined}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
