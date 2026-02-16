import React, { useState, useCallback } from 'react';
import type { PendingPermissionRequest } from '../../types/types';

interface QuestionOption {
  label: string;
  description: string;
}

interface Question {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

interface AskUserQuestionInput {
  questions: Question[];
  answers?: Record<string, string>;
}

interface AskUserQuestionPanelProps {
  request: PendingPermissionRequest;
  handlePermissionDecision: (
    requestIds: string | string[],
    decision: { allow?: boolean; message?: string; rememberEntry?: string | null; updatedInput?: unknown },
  ) => void;
}

function isAskUserQuestionInput(input: unknown): input is AskUserQuestionInput {
  if (!input || typeof input !== 'object') return false;
  const obj = input as Record<string, unknown>;
  return Array.isArray(obj.questions) && obj.questions.length > 0;
}

export function isAskUserQuestionRequest(request: PendingPermissionRequest): boolean {
  return request.toolName === 'AskUserQuestion' && isAskUserQuestionInput(request.input);
}

export default function AskUserQuestionPanel({ request, handlePermissionDecision }: AskUserQuestionPanelProps) {
  const input = request.input as AskUserQuestionInput;
  const questions = input.questions;

  // For single-select: Record<questionIndex, selectedOptionLabel>
  // For multi-select: Record<questionIndex, comma-separated labels>
  const [selections, setSelections] = useState<Record<number, Set<string>>>({});
  const [otherTexts, setOtherTexts] = useState<Record<number, string>>({});
  const [usingOther, setUsingOther] = useState<Record<number, boolean>>({});

  const handleOptionToggle = useCallback((questionIdx: number, label: string, multiSelect: boolean) => {
    setSelections((prev) => {
      const next = { ...prev };
      if (multiSelect) {
        const current = new Set(prev[questionIdx] || []);
        if (current.has(label)) {
          current.delete(label);
        } else {
          current.add(label);
        }
        next[questionIdx] = current;
      } else {
        next[questionIdx] = new Set([label]);
        // Clear "Other" when selecting a predefined option
        setUsingOther((p) => ({ ...p, [questionIdx]: false }));
        setOtherTexts((p) => ({ ...p, [questionIdx]: '' }));
      }
      return next;
    });
  }, []);

  const handleOtherToggle = useCallback((questionIdx: number, multiSelect: boolean) => {
    setUsingOther((prev) => {
      const next = { ...prev, [questionIdx]: !prev[questionIdx] };
      if (!multiSelect && next[questionIdx]) {
        // Clear predefined selections when switching to "Other" in single-select
        setSelections((p) => ({ ...p, [questionIdx]: new Set() }));
      }
      return next;
    });
  }, []);

  const handleOtherTextChange = useCallback((questionIdx: number, text: string) => {
    setOtherTexts((prev) => ({ ...prev, [questionIdx]: text }));
  }, []);

  const buildAnswers = useCallback((): Record<string, string> => {
    const answers: Record<string, string> = {};
    questions.forEach((q, idx) => {
      const parts: string[] = [];

      const selected = selections[idx];
      if (selected && selected.size > 0) {
        parts.push(...Array.from(selected));
      }

      if (usingOther[idx] && otherTexts[idx]?.trim()) {
        parts.push(otherTexts[idx].trim());
      }

      if (parts.length > 0) {
        answers[String(idx)] = parts.join(', ');
      }
    });
    return answers;
  }, [questions, selections, usingOther, otherTexts]);

  const hasAnyAnswer = useCallback((): boolean => {
    for (let idx = 0; idx < questions.length; idx++) {
      const selected = selections[idx];
      if (selected && selected.size > 0) return true;
      if (usingOther[idx] && otherTexts[idx]?.trim()) return true;
    }
    return false;
  }, [questions, selections, usingOther, otherTexts]);

  const handleSubmit = useCallback(() => {
    const answers = buildAnswers();
    handlePermissionDecision(request.requestId, {
      allow: true,
      updatedInput: {
        questions: input.questions,
        answers,
      },
    });
  }, [buildAnswers, handlePermissionDecision, request.requestId, input.questions]);

  const handleSkip = useCallback(() => {
    handlePermissionDecision(request.requestId, {
      allow: true,
      updatedInput: {
        questions: input.questions,
        answers: {},
      },
    });
  }, [handlePermissionDecision, request.requestId, input.questions]);

  return (
    <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-4 shadow-sm">
      <div className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-3">
        Claude has questions for you
      </div>

      <div className="space-y-4">
        {questions.map((q, qIdx) => (
          <div key={qIdx} className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center rounded-md bg-blue-100 dark:bg-blue-800/40 px-2 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-300">
                {q.header}
              </span>
            </div>
            <div className="text-sm text-blue-900 dark:text-blue-100">
              {q.question}
            </div>

            <div className="space-y-1.5 pl-1">
              {q.options.map((opt) => {
                const isSelected = selections[qIdx]?.has(opt.label) ?? false;
                return (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => handleOptionToggle(qIdx, opt.label, q.multiSelect)}
                    className={`w-full text-left rounded-md border px-3 py-2 text-sm transition-colors ${
                      isSelected
                        ? 'border-blue-500 bg-blue-100 dark:bg-blue-800/50 dark:border-blue-400 text-blue-900 dark:text-blue-100'
                        : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:border-blue-300 dark:hover:border-blue-600'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 flex-shrink-0">
                        {q.multiSelect ? (
                          <span className={`inline-flex h-4 w-4 items-center justify-center rounded border ${
                            isSelected
                              ? 'border-blue-500 bg-blue-500 text-white'
                              : 'border-gray-300 dark:border-gray-600'
                          }`}>
                            {isSelected && <span className="text-xs">&#10003;</span>}
                          </span>
                        ) : (
                          <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full border ${
                            isSelected
                              ? 'border-blue-500 bg-blue-500'
                              : 'border-gray-300 dark:border-gray-600'
                          }`}>
                            {isSelected && <span className="block h-2 w-2 rounded-full bg-white" />}
                          </span>
                        )}
                      </span>
                      <div className="min-w-0">
                        <div className="font-medium">{opt.label}</div>
                        {opt.description && (
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{opt.description}</div>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}

              {/* "Other" option */}
              <button
                type="button"
                onClick={() => handleOtherToggle(qIdx, q.multiSelect)}
                className={`w-full text-left rounded-md border px-3 py-2 text-sm transition-colors ${
                  usingOther[qIdx]
                    ? 'border-blue-500 bg-blue-100 dark:bg-blue-800/50 dark:border-blue-400 text-blue-900 dark:text-blue-100'
                    : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:border-blue-300 dark:hover:border-blue-600'
                }`}
              >
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 flex-shrink-0">
                    {q.multiSelect ? (
                      <span className={`inline-flex h-4 w-4 items-center justify-center rounded border ${
                        usingOther[qIdx]
                          ? 'border-blue-500 bg-blue-500 text-white'
                          : 'border-gray-300 dark:border-gray-600'
                      }`}>
                        {usingOther[qIdx] && <span className="text-xs">&#10003;</span>}
                      </span>
                    ) : (
                      <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full border ${
                        usingOther[qIdx]
                          ? 'border-blue-500 bg-blue-500'
                          : 'border-gray-300 dark:border-gray-600'
                      }`}>
                        {usingOther[qIdx] && <span className="block h-2 w-2 rounded-full bg-white" />}
                      </span>
                    )}
                  </span>
                  <div className="font-medium">Other</div>
                </div>
              </button>

              {usingOther[qIdx] && (
                <input
                  type="text"
                  value={otherTexts[qIdx] || ''}
                  onChange={(e) => handleOtherTextChange(qIdx, e.target.value)}
                  placeholder="Type your answer..."
                  autoFocus
                  className="w-full rounded-md border border-blue-300 dark:border-blue-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && hasAnyAnswer()) {
                      handleSubmit();
                    }
                  }}
                />
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!hasAnyAnswer()}
          className={`inline-flex items-center rounded-md text-xs font-medium px-4 py-1.5 transition-colors ${
            hasAnyAnswer()
              ? 'bg-blue-600 text-white hover:bg-blue-700'
              : 'bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed'
          }`}
        >
          Submit
        </button>
        <button
          type="button"
          onClick={handleSkip}
          className="inline-flex items-center rounded-md text-xs font-medium px-4 py-1.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          Skip
        </button>
      </div>
    </div>
  );
}
