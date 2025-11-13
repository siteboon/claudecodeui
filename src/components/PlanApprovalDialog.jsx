import React, { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { usePlanApproval } from '../contexts/PlanApprovalContext';

const PlanApprovalDialog = () => {
  const { activePlan, isProcessing, handlePlanApproval, handlePlanRejection } = usePlanApproval();
  const [timeRemaining, setTimeRemaining] = useState(null);

  useEffect(() => {
    if (!activePlan) {
      setTimeRemaining(null);
      return;
    }

    const updateTimer = () => {
      const now = Date.now();
      const remaining = Math.max(0, Math.floor((activePlan.expiresAt - now) / 1000));
      setTimeRemaining(remaining);

      if (remaining === 0) {
        clearInterval(intervalId);
      }
    };

    updateTimer();
    const intervalId = setInterval(updateTimer, 1000);

    return () => clearInterval(intervalId);
  }, [activePlan]);

  useEffect(() => {
    if (!activePlan) return;

    const handleKeyPress = (e) => {
      if (isProcessing) return;

      if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        handlePlanApproval(activePlan.planId, 'acceptEdits');
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        handlePlanApproval(activePlan.planId, 'default');
      } else if (e.key === 'r' || e.key === 'R' || e.key === 'Escape') {
        e.preventDefault();
        handlePlanRejection(activePlan.planId, 'User rejected the plan');
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [activePlan, isProcessing, handlePlanApproval, handlePlanRejection]);

  if (!activePlan) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-4xl max-h-[90vh] bg-white dark:bg-gray-800 rounded-2xl shadow-2xl flex flex-col animate-in zoom-in-95 duration-200">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/50 dark:to-indigo-950/50 rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 dark:from-blue-400 dark:to-indigo-500 flex items-center justify-center shadow-lg">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Implementation Plan Approval</h2>
              <p className="text-sm text-gray-600 dark:text-gray-400">Review and approve the proposed implementation</p>
            </div>
          </div>

          {/* Timeout indicator */}
          {timeRemaining !== null && (
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${
              timeRemaining <= 10
                ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
            }`}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-sm font-medium">{timeRemaining}s</span>
            </div>
          )}
        </div>

        {/* Plan Content - Scrollable */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:text-blue-900 dark:prose-headings:text-blue-100 prose-p:text-gray-700 dark:prose-p:text-gray-300 prose-li:text-gray-700 dark:prose-li:text-gray-300 prose-strong:text-blue-800 dark:prose-strong:text-blue-200">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {activePlan.content}
            </ReactMarkdown>
          </div>
        </div>

        {/* Actions Footer */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 rounded-b-2xl">
          <div className="flex flex-col sm:flex-row gap-3">

            {/* Approve & Auto-Execute */}
            <button
              onClick={() => handlePlanApproval(activePlan.planId, 'acceptEdits')}
              disabled={isProcessing}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 disabled:from-gray-400 disabled:to-gray-500 text-white rounded-lg font-medium transition-all duration-200 shadow-md hover:shadow-lg disabled:cursor-not-allowed group"
              title="Approve the plan and automatically execute all steps without further prompts (acceptEdits mode)"
            >
              <svg className="w-5 h-5 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <div className="flex flex-col items-start">
                <span>Approve & Auto-Execute</span>
                <span className="text-xs opacity-90">Press A</span>
              </div>
            </button>

            {/* Approve & Manual Review */}
            <button
              onClick={() => handlePlanApproval(activePlan.planId, 'default')}
              disabled={isProcessing}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 disabled:from-gray-400 disabled:to-gray-500 text-white rounded-lg font-medium transition-all duration-200 shadow-md hover:shadow-lg disabled:cursor-not-allowed group"
              title="Approve the plan but review each step manually (default mode)"
            >
              <svg className="w-5 h-5 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="flex flex-col items-start">
                <span>Approve & Manual Review</span>
                <span className="text-xs opacity-90">Press M</span>
              </div>
            </button>

            {/* Reject Plan */}
            <button
              onClick={() => handlePlanRejection(activePlan.planId, 'User rejected the plan')}
              disabled={isProcessing}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700 disabled:from-gray-400 disabled:to-gray-500 text-white rounded-lg font-medium transition-all duration-200 shadow-md hover:shadow-lg disabled:cursor-not-allowed group"
              title="Reject the plan and cancel execution"
            >
              <svg className="w-5 h-5 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              <div className="flex flex-col items-start">
                <span>Reject Plan</span>
                <span className="text-xs opacity-90">Press R or ESC</span>
              </div>
            </button>

          </div>

          {/* Help text */}
          <div className="mt-3 text-xs text-gray-500 dark:text-gray-400 text-center">
            <span className="font-medium">Auto-Execute</span>: Tools run without prompts •
            <span className="font-medium"> Manual Review</span>: Review each tool before execution
          </div>
        </div>

      </div>
    </div>
  );
};

export default PlanApprovalDialog;
