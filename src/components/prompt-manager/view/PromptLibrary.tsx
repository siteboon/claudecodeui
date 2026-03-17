import React, { useMemo, useState } from 'react';
import { CircleHelp, Search, X } from 'lucide-react';
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
  const [activeTab, setActiveTab] = useState<PromptType>('role');
  const [searchQuery, setSearchQuery] = useState('');
  const [showHelp, setShowHelp] = useState(false);

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
      <div className="flex max-h-[80vh] w-full max-w-4xl flex-col rounded-lg bg-white shadow-xl dark:bg-gray-900">
        <div className="relative flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
          <div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              Prompt Library
            </h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Roles add persistent context. Templates insert reusable text.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowHelp((previous) => !previous)}
              className="inline-flex items-center gap-2 rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              title="How to create your own prompt"
            >
              <CircleHelp className="h-4 w-4" />
              How to add your own
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
                    Create your own roles or templates
                  </p>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    Add markdown prompt files and they will appear in this library.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowHelp(false)}
                  className="rounded p-1 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
                  title="Close help"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-3 text-sm text-gray-700 dark:text-gray-200">
                <p>
                  Add markdown files to <code>~/.claude/prompts/</code> for global prompts or
                  <code> {'{project}/.claude/prompts/'}</code> for project-specific prompts.
                </p>
                <p>
                  Use <code>type: role</code> for persistent context and <code>type: template</code>
                  for reusable input text.
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
            Roles
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
            Templates
          </button>
        </div>

        <div className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 transform text-gray-400" />
            <input
              type="text"
              placeholder="Search prompts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-10 pr-4 dark:border-gray-600 dark:bg-gray-800"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="py-8 text-center">Loading prompts...</div>
          ) : error ? (
            <div className="py-8 text-center">
              <div className="mb-2 text-red-600 dark:text-red-400">Failed to load prompts</div>
              <div className="text-sm text-gray-600 dark:text-gray-400">{error}</div>
            </div>
          ) : Object.keys(groupedPrompts).length === 0 ? (
            <div className="py-8 text-center">No prompts found</div>
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
