import React, { useState, useEffect } from 'react';
import { cn } from '../lib/utils';

function GeminiStatus({ status, onAbort, isLoading }) {
  const [elapsedTime, setElapsedTime] = useState(0);
  const [animationPhase, setAnimationPhase] = useState(0);
  
  // Update elapsed time every second
  useEffect(() => {
    if (!isLoading) {
      setElapsedTime(0);
      return;
    }
    
    const startTime = Date.now();
    const timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      setElapsedTime(elapsed);
    }, 1000);
    
    return () => clearInterval(timer);
  }, [isLoading]);
  
  // Animate the status indicator
  useEffect(() => {
    if (!isLoading) return;
    
    const timer = setInterval(() => {
      setAnimationPhase(prev => (prev + 1) % 4);
    }, 500);
    
    return () => clearInterval(timer);
  }, [isLoading]);
  
  if (!isLoading) return null;
  
  // Clever action words that cycle
  const actionWords = ['Thinking', 'Processing', 'Analyzing', 'Working', 'Computing', 'Reasoning'];
  const actionIndex = Math.floor(elapsedTime / 3) % actionWords.length;
  
  // Parse status data
  const statusText = status?.text || actionWords[actionIndex];
  const canInterrupt = status?.can_interrupt !== false;
  
  // Animation characters
  const spinners = ['✻', '✹', '✸', '✶'];
  const currentSpinner = spinners[animationPhase];
  
  return (
    <div className="w-full mb-6 animate-in slide-in-from-bottom duration-300">
      <div className="flex items-center justify-between max-w-4xl mx-auto bg-gradient-to-r from-cyan-900 to-blue-900 dark:from-cyan-950 dark:to-blue-950 text-white rounded-lg shadow-lg px-4 py-3">
        <div className="flex-1">
          <div className="flex items-center gap-3">
            {/* Animated spinner */}
            <span className={cn(
              "text-xl transition-all duration-500",
              animationPhase % 2 === 0 ? "text-cyan-400 scale-110" : "text-cyan-300"
            )}>
              {currentSpinner}
            </span>
            
            {/* Status text - first line */}
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">{statusText}...</span>
                <span className="text-gray-400 text-sm">({elapsedTime}s)</span>
              </div>
            </div>
          </div>
        </div>
        
        {/* Interrupt button */}
        {canInterrupt && onAbort && (
          <button
            onClick={onAbort}
            className="ml-3 text-xs bg-red-600 hover:bg-red-700 text-white px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-md transition-colors flex items-center gap-1.5 flex-shrink-0"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            <span className="hidden sm:inline">Stop</span>
          </button>
        )}
      </div>
    </div>
  );
}

export default GeminiStatus;