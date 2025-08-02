/**
 * Utilities for extracting and processing markdown content from tool results
 */

/**
 * Detects the content type of a given text
 * @param {string} content - The content to analyze
 * @returns {'markdown' | 'json' | 'text' | 'mixed'} The detected content type
 */
export function detectContentType(content) {
  if (!content || typeof content !== 'string') {
    return 'text';
  }

  const trimmed = content.trim();

  // Check for JSON
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || 
      (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch {
      // Not valid JSON, continue checking
    }
  }

  // Check for markdown indicators
  const markdownPatterns = [
    /^#{1,6}\s/m,           // Headers
    /^\*\s|^-\s|^\d+\.\s/m, // Lists
    /```[\s\S]*```/,        // Code blocks
    /`[^`]+`/,              // Inline code
    /\*\*[^*]+\*\*/,        // Bold
    /\*[^*]+\*/,            // Italic
    /\[.+\]\(.+\)/,         // Links
    /^>/m,                  // Blockquotes
  ];

  const hasMarkdown = markdownPatterns.some(pattern => pattern.test(content));
  return hasMarkdown ? 'markdown' : 'text';
}

/**
 * Extracts meaningful content from tool results
 * @param {string} toolName - The name of the tool
 * @param {string} toolInput - The tool input parameters
 * @param {string} toolResult - The tool result/output
 * @returns {Object} Extracted content with type and metadata
 */
export function extractToolContent(toolName, toolInput, toolResult) {
  // Priority: toolResult > meaningful toolInput content > raw parameters
  
  // First, try to extract from tool result
  if (toolResult && typeof toolResult === 'string' && toolResult.trim()) {
    const contentType = detectContentType(toolResult);
    
    // Special handling for specific tools
    if (toolName === 'exit_plan_mode' || toolName === 'ExitPlanMode') {
      try {
        // Try to parse JSON response
        const parsed = JSON.parse(toolResult);
        if (parsed.plan) {
          return {
            contentType: 'markdown',
            primaryContent: parsed.plan.replace(/\\n/g, '\n'),
            metadata: { title: 'Implementation Plan' }
          };
        }
      } catch {
        // If not JSON, use the raw content
        return {
          contentType,
          primaryContent: toolResult,
          metadata: { title: 'Plan Result' }
        };
      }
    }

    // For Result tool, extract the content
    if (toolName === 'Result') {
      return {
        contentType,
        primaryContent: toolResult,
        metadata: { title: 'Result' }
      };
    }

    // Generic tool result handling
    return {
      contentType,
      primaryContent: toolResult,
      metadata: { toolName }
    };
  }

  // Next, try to extract from tool input
  if (toolInput && typeof toolInput === 'string') {
    try {
      const input = JSON.parse(toolInput);
      
      // ExitPlanMode tool input handling
      if ((toolName === 'exit_plan_mode' || toolName === 'ExitPlanMode') && input.plan) {
        return {
          contentType: 'markdown',
          primaryContent: input.plan.replace(/\\n/g, '\n'),
          metadata: { title: 'Implementation Plan' }
        };
      }

      // Result tool input handling
      if (toolName === 'Result' && input.result) {
        const contentType = detectContentType(input.result);
        return {
          contentType,
          primaryContent: input.result,
          metadata: { title: 'Result' }
        };
      }

      // Write/Edit tool content
      if ((toolName === 'Write' || toolName === 'Edit') && input.content) {
        return {
          contentType: 'text',
          primaryContent: input.content,
          metadata: { 
            language: detectLanguageFromPath(input.file_path || input.path),
            filePath: input.file_path || input.path
          }
        };
      }

      // MultiEdit tool
      if (toolName === 'MultiEdit' && input.edits) {
        return {
          contentType: 'mixed',
          primaryContent: JSON.stringify(input.edits, null, 2),
          metadata: { 
            filePath: input.file_path || input.path,
            editCount: input.edits.length
          }
        };
      }

      // Read tool
      if (toolName === 'Read' && input.file_path) {
        return {
          contentType: 'text',
          primaryContent: toolInput, // Will be replaced by actual content in result
          metadata: { 
            filePath: input.file_path,
            language: detectLanguageFromPath(input.file_path)
          }
        };
      }

    } catch {
      // Failed to parse input, fall back to raw display
    }
  }

  // Fallback: return raw parameters
  return {
    contentType: 'json',
    primaryContent: toolInput || '',
    metadata: { toolName },
    fallback: true
  };
}

/**
 * Detects programming language from file path
 * @param {string} filePath - The file path to analyze
 * @returns {string} The detected language or empty string
 */
export function detectLanguageFromPath(filePath) {
  if (!filePath) return '';

  const ext = filePath.split('.').pop()?.toLowerCase();
  const languageMap = {
    'js': 'javascript',
    'jsx': 'javascript',
    'ts': 'typescript',
    'tsx': 'typescript',
    'py': 'python',
    'rb': 'ruby',
    'java': 'java',
    'cpp': 'cpp',
    'c': 'c',
    'cs': 'csharp',
    'php': 'php',
    'go': 'go',
    'rs': 'rust',
    'swift': 'swift',
    'kt': 'kotlin',
    'scala': 'scala',
    'sh': 'bash',
    'bash': 'bash',
    'zsh': 'bash',
    'ps1': 'powershell',
    'sql': 'sql',
    'html': 'html',
    'css': 'css',
    'scss': 'scss',
    'sass': 'sass',
    'less': 'less',
    'xml': 'xml',
    'json': 'json',
    'yaml': 'yaml',
    'yml': 'yaml',
    'md': 'markdown',
    'markdown': 'markdown',
    'rst': 'rst',
    'tex': 'latex',
    'r': 'r',
    'matlab': 'matlab',
    'lua': 'lua',
    'vim': 'vim',
    'dockerfile': 'dockerfile',
    'makefile': 'makefile',
  };

  return languageMap[ext] || ext || '';
}

/**
 * Sanitizes content for safe rendering
 * @param {string} content - The content to sanitize
 * @returns {string} Sanitized content
 */
export function sanitizeContent(content) {
  if (!content || typeof content !== 'string') {
    return '';
  }

  // Remove any potential script tags (additional safety layer)
  return content
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '');
}

/**
 * Truncates content with ellipsis if too long
 * @param {string} content - The content to truncate
 * @param {number} maxLength - Maximum length before truncation
 * @returns {Object} Object with truncated content and isTruncated flag
 */
export function truncateContent(content, maxLength = 5000) {
  if (!content || content.length <= maxLength) {
    return { content, isTruncated: false };
  }

  const truncated = content.substring(0, maxLength);
  return { 
    content: truncated + '...', 
    isTruncated: true,
    fullLength: content.length
  };
}

/**
 * Preprocesses markdown content to convert single-quoted text to inline code
 * @param {string} content - The markdown content to preprocess
 * @returns {string} Preprocessed content with single quotes converted to backticks
 */
export function preprocessMarkdown(content) {
  if (!content || typeof content !== 'string') {
    return content;
  }

  // Split content by code blocks to preserve them
  const codeBlockPattern = /```[\s\S]*?```/g;
  const codeBlocks = content.match(codeBlockPattern) || [];
  
  // Replace code blocks with placeholders
  let processed = content;
  codeBlocks.forEach((block, i) => {
    processed = processed.replace(block, `__CODE_BLOCK_${i}__`);
  });
  
  // Convert 'text' to `text` (but not contractions or possessives)
  // Matches 'word' or 'multiple words' but not don't, won't, it's, etc.
  // Also avoids matching quotes at the start/end of lines to prevent issues with quoted speech
  processed = processed.replace(/(?<![a-zA-Z])'([^']+?)'(?![a-zA-Z])/g, '`$1`');
  
  // Restore code blocks
  codeBlocks.forEach((block, i) => {
    processed = processed.replace(`__CODE_BLOCK_${i}__`, block);
  });
  
  return processed;
}