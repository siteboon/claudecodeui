import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Prompt } from '../types/types';

interface RoleToggleProps {
  isActive: boolean;
  onChange: () => void;
  disabled?: boolean;
}

function RoleToggle({ isActive, onChange, disabled }: RoleToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isActive}
      disabled={disabled}
      onClick={onChange}
      className={`
        relative inline-flex h-6 w-11 items-center rounded-full transition-colors
        ${isActive ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'}
        ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}
      `}
    >
      <span
        className={`
          inline-block h-4 w-4 transform rounded-full bg-white transition-transform
          ${isActive ? 'translate-x-6' : 'translate-x-1'}
        `}
      />
    </button>
  );
}

interface PromptCardProps {
  prompt: Prompt;
  onApply?: (prompt: Prompt) => void;
  onInsert?: (prompt: Prompt) => void;
  onToggle?: (prompt: Prompt) => void;
  isActive?: boolean;
}

export default function PromptCard({ prompt, onApply, onInsert, onToggle, isActive = false }: PromptCardProps) {
  const { t } = useTranslation('chat');
  const [optimisticActive, setOptimisticActive] = useState(isActive);

  // Sync optimistic state with actual state
  useEffect(() => {
    setOptimisticActive(isActive);
  }, [isActive]);

  const handleToggle = () => {
    // Optimistically update UI immediately
    setOptimisticActive(!optimisticActive);
    // Then call the actual toggle function
    onToggle?.(prompt);
  };

  return (
    <div className="rounded-lg border border-gray-200 p-4 transition-colors hover:border-blue-500 dark:border-gray-700 dark:hover:border-blue-400">
      <div className="mb-2 flex items-start justify-between">
        <div className="flex items-center gap-2">
          {prompt.icon && <span className="text-2xl">{prompt.icon}</span>}
          <h4 className="font-semibold text-gray-900 dark:text-gray-100">{prompt.name}</h4>
        </div>
        <div className="flex items-center gap-2">
          {prompt.type === 'role' && onToggle && (
            <RoleToggle
              isActive={optimisticActive}
              onChange={handleToggle}
            />
          )}
          {prompt.namespace && (
            <span className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-400">
              {prompt.namespace}
            </span>
          )}
        </div>
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

      {!onToggle && (
        <div className="flex gap-2">
          {onApply && (
            <button
              onClick={() => onApply(prompt)}
              className="flex-1 rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              {t('promptLibrary.actions.applyRole')}
            </button>
          )}
          {onInsert && (
            <button
              onClick={() => onInsert(prompt)}
              className="flex-1 rounded bg-green-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-green-700"
            >
              {t('promptLibrary.actions.insertTemplate')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
