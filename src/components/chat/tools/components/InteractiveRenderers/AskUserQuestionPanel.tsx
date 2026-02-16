import React, { useState, useCallback, useRef, useEffect } from 'react';
import type { PermissionPanelProps } from '../../configs/permissionPanelRegistry';
import type { Question } from '../../../types/types';

export const AskUserQuestionPanel: React.FC<PermissionPanelProps> = ({
  request,
  onDecision,
}) => {
  const input = request.input as { questions?: Question[] } | undefined;
  const questions: Question[] = input?.questions || [];

  const [currentStep, setCurrentStep] = useState(0);
  const [selections, setSelections] = useState<Map<number, Set<string>>>(() => new Map());
  const [otherTexts, setOtherTexts] = useState<Map<number, string>>(() => new Map());
  const [otherActive, setOtherActive] = useState<Map<number, boolean>>(() => new Map());
  const [mounted, setMounted] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const otherInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    requestAnimationFrame(() => setMounted(true));
  }, []);

  // Focus the container for keyboard events when step changes
  useEffect(() => {
    if (!otherActive.get(currentStep)) {
      containerRef.current?.focus();
    }
  }, [currentStep, otherActive]);

  useEffect(() => {
    if (otherActive.get(currentStep)) {
      otherInputRef.current?.focus();
    }
  }, [otherActive, currentStep]);

  const toggleOption = useCallback((qIdx: number, label: string, multiSelect: boolean) => {
    setSelections(prev => {
      const next = new Map(prev);
      const current = new Set(next.get(qIdx) || []);
      if (multiSelect) {
        if (current.has(label)) current.delete(label);
        else current.add(label);
      } else {
        current.clear();
        current.add(label);
        setOtherActive(p => { const n = new Map(p); n.set(qIdx, false); return n; });
      }
      next.set(qIdx, current);
      return next;
    });
  }, []);

  const toggleOther = useCallback((qIdx: number, multiSelect: boolean) => {
    setOtherActive(prev => {
      const next = new Map(prev);
      const wasActive = next.get(qIdx) || false;
      next.set(qIdx, !wasActive);
      if (!multiSelect && !wasActive) {
        setSelections(p => { const n = new Map(p); n.set(qIdx, new Set()); return n; });
      }
      return next;
    });
  }, []);

  const setOtherText = useCallback((qIdx: number, text: string) => {
    setOtherTexts(prev => { const next = new Map(prev); next.set(qIdx, text); return next; });
  }, []);

  const buildAnswers = useCallback(() => {
    const answers: Record<string, string> = {};
    questions.forEach((q, idx) => {
      const selected = Array.from(selections.get(idx) || []);
      const isOther = otherActive.get(idx) || false;
      const otherText = (otherTexts.get(idx) || '').trim();
      if (isOther && otherText) selected.push(otherText);
      if (selected.length > 0) answers[q.question] = selected.join(', ');
    });
    return answers;
  }, [questions, selections, otherActive, otherTexts]);

  const handleSubmit = useCallback(() => {
    onDecision(request.requestId, { allow: true, updatedInput: { ...input, answers: buildAnswers() } });
  }, [onDecision, request.requestId, input, buildAnswers]);

  const handleSkip = useCallback(() => {
    onDecision(request.requestId, { allow: true, updatedInput: { ...input, answers: {} } });
  }, [onDecision, request.requestId, input]);

  // Keyboard handler for number keys and navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Don't capture keys when typing in the "Other" input
    if (e.target instanceof HTMLInputElement) return;

    const q = questions[currentStep];
    if (!q) return;
    const multi = q.multiSelect || false;
    const optCount = q.options.length;

    // Number keys 1-9 for options
    const num = parseInt(e.key);
    if (!isNaN(num) && num >= 1 && num <= optCount) {
      e.preventDefault();
      toggleOption(currentStep, q.options[num - 1].label, multi);
      return;
    }

    // 0 for "Other"
    if (e.key === '0') {
      e.preventDefault();
      toggleOther(currentStep, multi);
      return;
    }

    // Enter to advance / submit
    if (e.key === 'Enter') {
      e.preventDefault();
      const isLast = currentStep === questions.length - 1;
      if (isLast) handleSubmit();
      else setCurrentStep(s => s + 1);
      return;
    }

    // Escape to skip
    if (e.key === 'Escape') {
      e.preventDefault();
      handleSkip();
      return;
    }
  }, [currentStep, questions, toggleOption, toggleOther, handleSubmit, handleSkip]);

  if (questions.length === 0) return null;

  const total = questions.length;
  const isSingle = total === 1;
  const q = questions[currentStep];
  const multi = q.multiSelect || false;
  const selected = selections.get(currentStep) || new Set<string>();
  const isOtherOn = otherActive.get(currentStep) || false;
  const isLast = currentStep === total - 1;
  const isFirst = currentStep === 0;
  const hasCurrentSelection = selected.size > 0 || (isOtherOn && (otherTexts.get(currentStep) || '').trim().length > 0);

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className={`w-full outline-none transition-all duration-500 ease-out ${
        mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
      }`}
    >
      <div className="relative overflow-hidden rounded-2xl border border-gray-200/80 dark:border-gray-700/50 bg-white dark:bg-gray-800/90 shadow-lg dark:shadow-2xl">
        {/* Accent line */}
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-blue-500 via-cyan-400 to-teal-400" />

        {/* Header + Question — compact */}
        <div className="px-4 pt-3.5 pb-2">
          <div className="flex items-center gap-2.5 mb-1.5">
            {/* Question icon */}
            <div className="relative flex-shrink-0">
              <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-blue-500/10 to-cyan-500/10 dark:from-blue-400/15 dark:to-cyan-400/15 flex items-center justify-center">
                <svg className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827m0 3h.01" />
                </svg>
              </div>
              <div className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-cyan-400 dark:bg-cyan-500 animate-pulse" />
            </div>

            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className="text-[10px] font-medium tracking-wide uppercase text-gray-400 dark:text-gray-500">
                Claude needs your input
              </span>
              {q.header && (
                <span className="inline-flex items-center px-1.5 py-px rounded text-[9px] font-semibold uppercase tracking-wider bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-800/50">
                  {q.header}
                </span>
              )}
            </div>

            {/* Step counter */}
            {!isSingle && (
              <span className="text-[10px] tabular-nums text-gray-400 dark:text-gray-500 flex-shrink-0">
                {currentStep + 1}/{total}
              </span>
            )}
          </div>

          {/* Progress dots (multi-question) */}
          {!isSingle && (
            <div className="flex items-center gap-1 mb-2">
              {questions.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setCurrentStep(i)}
                  className={`h-[3px] rounded-full transition-all duration-300 ${
                    i === currentStep
                      ? 'w-5 bg-blue-500 dark:bg-blue-400'
                      : i < currentStep
                        ? 'w-2.5 bg-blue-300 dark:bg-blue-600'
                        : 'w-2.5 bg-gray-200 dark:bg-gray-700'
                  }`}
                />
              ))}
            </div>
          )}

          {/* Question text */}
          <p className="text-[14px] leading-snug font-medium text-gray-900 dark:text-gray-100">
            {q.question}
          </p>
          {multi && (
            <span className="text-[10px] text-gray-400 dark:text-gray-500">Select all that apply</span>
          )}
        </div>

        {/* Options — tight spacing */}
        <div className="px-4 pb-2 max-h-48 overflow-y-auto scrollbar-thin" role={multi ? 'group' : 'radiogroup'} aria-label={q.question}>
          <div className="space-y-1">
            {q.options.map((opt, optIdx) => {
              const isSelected = selected.has(opt.label);
              return (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => toggleOption(currentStep, opt.label, multi)}
                  className={`group w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-lg border transition-all duration-150 ${
                    isSelected
                      ? 'border-blue-300 dark:border-blue-600 bg-blue-50/80 dark:bg-blue-900/25 ring-1 ring-blue-200/50 dark:ring-blue-700/30'
                      : 'border-gray-200 dark:border-gray-700/60 hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50/60 dark:hover:bg-gray-750/50'
                  }`}
                >
                  {/* Keyboard hint */}
                  <kbd className={`flex-shrink-0 w-5 h-5 rounded text-[10px] font-mono flex items-center justify-center transition-all duration-150 ${
                    isSelected
                      ? 'bg-blue-500 dark:bg-blue-500 text-white font-semibold'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 border border-gray-200 dark:border-gray-700 group-hover:border-gray-300 dark:group-hover:border-gray-600'
                  }`}>
                    {optIdx + 1}
                  </kbd>

                  <div className="flex-1 min-w-0">
                    <div className={`text-[13px] leading-tight transition-colors duration-150 ${
                      isSelected
                        ? 'text-gray-900 dark:text-gray-100 font-medium'
                        : 'text-gray-700 dark:text-gray-300'
                    }`}>
                      {opt.label}
                    </div>
                    {opt.description && (
                      <div className={`text-[11px] leading-snug transition-colors duration-150 ${
                        isSelected
                          ? 'text-blue-600/70 dark:text-blue-300/70'
                          : 'text-gray-400 dark:text-gray-500'
                      }`}>
                        {opt.description}
                      </div>
                    )}
                  </div>

                  {/* Selection check */}
                  {isSelected && (
                    <svg className="w-4 h-4 text-blue-500 dark:text-blue-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  )}
                </button>
              );
            })}

            {/* "Other" option */}
            <button
              type="button"
              onClick={() => toggleOther(currentStep, multi)}
              className={`group w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-lg border transition-all duration-150 ${
                isOtherOn
                  ? 'border-blue-300 dark:border-blue-600 bg-blue-50/80 dark:bg-blue-900/25 ring-1 ring-blue-200/50 dark:ring-blue-700/30'
                  : 'border-dashed border-gray-200 dark:border-gray-700/60 hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50/60 dark:hover:bg-gray-750/50'
              }`}
            >
              <kbd className={`flex-shrink-0 w-5 h-5 rounded text-[10px] font-mono flex items-center justify-center transition-all duration-150 ${
                isOtherOn
                  ? 'bg-blue-500 dark:bg-blue-500 text-white font-semibold'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 border border-gray-200 dark:border-gray-700 group-hover:border-gray-300 dark:group-hover:border-gray-600'
              }`}>
                0
              </kbd>
              <span className={`text-[13px] leading-tight transition-colors ${
                isOtherOn
                  ? 'text-gray-900 dark:text-gray-100 font-medium'
                  : 'text-gray-500 dark:text-gray-400'
              }`}>
                Other...
              </span>
              {isOtherOn && (
                <svg className="w-4 h-4 text-blue-500 dark:text-blue-400 flex-shrink-0 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              )}
            </button>

            {/* Other text input — inline */}
            {isOtherOn && (
              <div className="pl-[30px] pr-0.5">
                <div className="relative">
                  <input
                    ref={otherInputRef}
                    type="text"
                    value={otherTexts.get(currentStep) || ''}
                    onChange={(e) => setOtherText(currentStep, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (isLast) handleSubmit();
                        else setCurrentStep(s => s + 1);
                      }
                      // Prevent container keydown from firing
                      e.stopPropagation();
                    }}
                    placeholder="Type your answer..."
                    className="w-full text-[13px] rounded-lg border-0 bg-gray-50 dark:bg-gray-900/60 text-gray-900 dark:text-gray-100 px-3 py-1.5 outline-none ring-1 ring-gray-200 dark:ring-gray-700 focus:ring-2 focus:ring-blue-400 dark:focus:ring-blue-500 placeholder:text-gray-400 dark:placeholder:text-gray-600 transition-shadow duration-200"
                  />
                  <kbd className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] font-mono text-gray-300 dark:text-gray-600 bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded border border-gray-200 dark:border-gray-700">
                    Enter
                  </kbd>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer — compact */}
        <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-700/50 bg-gray-50/50 dark:bg-gray-800/50 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={handleSkip}
            className="text-[11px] text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            {isSingle ? 'Skip' : 'Skip all'}
            <span className="ml-1 text-[9px] text-gray-300 dark:text-gray-600">Esc</span>
          </button>

          <div className="flex items-center gap-1.5">
            {!isSingle && !isFirst && (
              <button
                type="button"
                onClick={() => setCurrentStep(s => s - 1)}
                className="inline-flex items-center gap-0.5 text-[11px] font-medium px-2.5 py-1.5 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/60 transition-all duration-150"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
                Back
              </button>
            )}

            {isLast ? (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!hasCurrentSelection && !Object.keys(buildAnswers()).length}
                className="inline-flex items-center gap-1 text-[11px] font-semibold px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-blue-500 dark:from-blue-500 dark:to-blue-600 text-white shadow-sm hover:shadow-md disabled:opacity-30 disabled:cursor-not-allowed disabled:shadow-none transition-all duration-200"
              >
                Submit
                <span className="text-[9px] opacity-70 font-mono ml-0.5">Enter</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setCurrentStep(s => s + 1)}
                className="inline-flex items-center gap-1 text-[11px] font-semibold px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-blue-500 dark:from-blue-500 dark:to-blue-600 text-white shadow-sm hover:shadow-md transition-all duration-200"
              >
                Next
                <span className="text-[9px] opacity-70 font-mono ml-0.5">Enter</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
