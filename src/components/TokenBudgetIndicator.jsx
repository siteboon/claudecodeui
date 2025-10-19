import React from 'react';
import { cn } from '../lib/utils';

/**
 * TokenBudgetIndicator - Display Claude's token budget with visual progress bar
 *
 * Shows:
 * - Token usage (used/total)
 * - Remaining tokens
 * - Visual progress bar with color coding based on remaining tokens
 *
 * Color coding:
 * - Green: > 60,000 tokens remaining (healthy)
 * - Yellow: 30,000-60,000 tokens remaining (warning)
 * - Red: < 30,000 tokens remaining (critical - auto-compact threshold)
 *
 * @param {object} tokenData - Token budget data from backend
 * @param {number} tokenData.used - Tokens used in current session
 * @param {number} tokenData.total - Total token budget (200,000)
 * @param {number} tokenData.remaining - Remaining tokens available
 */
function TokenBudgetIndicator({ tokenData }) {
  if (!tokenData) return null;

  const { used, total, remaining } = tokenData;
  // Guard against division by zero
  const percentage = total > 0 ? (used / total) * 100 : 0;

  // Color coding based on remaining tokens
  const getStatusColor = () => {
    if (remaining < 30000) return 'text-red-500';
    if (remaining < 60000) return 'text-yellow-500';
    return 'text-green-500';
  };

  const getBarColor = () => {
    if (remaining < 30000) return 'bg-red-500';
    if (remaining < 60000) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  return (
    <div className="px-4 py-2 bg-gray-900 dark:bg-gray-950 text-white rounded-lg shadow-lg">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-gray-400">Token Budget</span>
        <span className={cn("text-xs font-medium", getStatusColor())}>
          {remaining.toLocaleString()} remaining
        </span>
      </div>

      <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
        <div
          className={cn("h-full transition-all duration-300", getBarColor())}
          style={{ width: `${percentage}%` }}
        />
      </div>

      <div className="flex items-center justify-between mt-1">
        <span className="text-xs text-gray-400">
          {used.toLocaleString()} / {total.toLocaleString()} tokens used
        </span>
        <span className="text-xs text-gray-400">
          {percentage.toFixed(1)}%
        </span>
      </div>
    </div>
  );
}

export default TokenBudgetIndicator;
