import React from 'react';
import { Prompt } from '../types/types';

interface PromptCardProps {
  prompt: Prompt;
  onApply?: (prompt: Prompt) => void;
  onInsert?: (prompt: Prompt) => void;
}

export default function PromptCard({ prompt, onApply, onInsert }: PromptCardProps) {
  return (
    <div className="rounded-lg border border-gray-200 p-4 transition-colors hover:border-blue-500 dark:border-gray-700 dark:hover:border-blue-400">
      <div className="mb-2 flex items-start justify-between">
        <div className="flex items-center gap-2">
          {prompt.icon && <span className="text-2xl">{prompt.icon}</span>}
          <h4 className="font-semibold text-gray-900 dark:text-gray-100">{prompt.name}</h4>
        </div>
        {prompt.namespace && (
          <span className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-400">
            {prompt.namespace}
          </span>
        )}
      </div>

      <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">
        {prompt.description}
      </p>

      {prompt.tags && prompt.tags.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1">
          {prompt.tags.map((tag) => (
            <span
              key={tag}
              className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900 dark:text-blue-300"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        {onApply && (
          <button
            onClick={() => onApply(prompt)}
            className="flex-1 rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            Apply Role
          </button>
        )}
        {onInsert && (
          <button
            onClick={() => onInsert(prompt)}
            className="flex-1 rounded bg-green-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-green-700"
          >
            Insert Template
          </button>
        )}
      </div>
    </div>
  );
}
