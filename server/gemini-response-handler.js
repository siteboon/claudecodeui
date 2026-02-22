// Gemini Response Handler - Intelligent message buffering
class GeminiResponseHandler {
  constructor(ws, options = {}) {
    this.ws = ws;
    this.buffer = '';
    this.lastSentTime = Date.now();
    this.flushTimer = null;
    this.isAccumulating = false;
    this.inCodeBlock = false;
    this.codeBlockDepth = 0;

    // Configuration
    this.config = {
      // Wait time before sending partial message (ms)
      partialDelay: 500,
      // Maximum time to wait for complete message (ms)
      maxWaitTime: 2000,
      // Minimum buffer size before sending
      minBufferSize: 50,
      // Pattern to detect message completion
      completionPatterns: [
        /\.\s*$/,        // Ends with period
        /\?\s*$/,        // Ends with question mark
        /!\s*$/,         // Ends with exclamation
        /```\s*$/,       // Ends with code block
        /:\s*$/,         // Ends with colon
        /\n\n$/,         // Double line break
      ],
      ...options
    };
  }

  // Process incoming data from Gemini
  processData(data) {
    // Add to buffer
    this.buffer += data;

    // Update code block tracking
    this.updateCodeBlockState();

    // If we're in a code block, wait for it to complete
    if (this.inCodeBlock) {
      // Only flush if we have a complete code block
      if (this.isCodeBlockComplete()) {
        this.flush();
      } else {
        // Wait for more data, but set a max timeout
        this.scheduleFlush(1500); // Wait longer for code blocks
      }
    } else {
      // Normal processing for non-code content
      if (this.shouldSendImmediately()) {
        this.flush();
      } else {
        this.scheduleFlush();
      }
    }
  }

  // Update code block tracking state
  updateCodeBlockState() {
    const codeBlockStarts = (this.buffer.match(/```/g) || []).length;
    this.codeBlockDepth = codeBlockStarts;
    this.inCodeBlock = (codeBlockStarts % 2) !== 0;
  }

  // Check if current code block is complete
  isCodeBlockComplete() {
    const codeBlockCount = (this.buffer.match(/```/g) || []).length;
    return codeBlockCount > 0 && codeBlockCount % 2 === 0;
  }

  // Check if buffer contains a complete logical unit
  shouldSendImmediately() {
    // Don't send tiny fragments
    if (this.buffer.length < this.config.minBufferSize) {
      return false;
    }

    // Never split in the middle of a code block
    if (this.inCodeBlock) {
      return false;
    }

    // Check for completion patterns
    const trimmedBuffer = this.buffer.trim();

    // Check if it ends with a complete sentence or logical unit
    for (const pattern of this.config.completionPatterns) {
      if (pattern.test(trimmedBuffer)) {
        return true;
      }
    }

    // Check for complete list items
    if (trimmedBuffer.match(/^\d+\.\s+.+$/m) || trimmedBuffer.match(/^[-*]\s+.+$/m)) {
      // If it's a list and ends with newline, consider it complete
      if (trimmedBuffer.endsWith('\n')) {
        return true;
      }
    }

    // Check if enough time has passed since last send
    const timeSinceLastSend = Date.now() - this.lastSentTime;
    if (timeSinceLastSend > this.config.maxWaitTime && this.buffer.length > 0) {
      return true;
    }

    return false;
  }

  // Schedule a delayed flush
  scheduleFlush(customDelay = null) {
    // Clear existing timer
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }

    // Use custom delay or default
    const delay = customDelay || this.config.partialDelay;

    // Set new timer
    this.flushTimer = setTimeout(() => {
      if (this.buffer.length > 0) {
        this.flush();
      }
    }, delay);
  }

  // Send buffered content
  flush() {
    if (this.buffer.length === 0) {
      return;
    }

    // Clear timer
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    // Process buffer content
    let content = this.buffer.trim();

    // Fix common formatting issues
    content = this.fixFormatting(content);

    // Send if we have content
    if (content) {
      console.log(`[Gemini Handler] Flushing ${content.length} characters to frontend... (Partial: ${!this.isComplete(content)})`);
      const socketSessionId = typeof this.ws.getSessionId === 'function' ? this.ws.getSessionId() : null;
      let payload = {
        type: 'gemini-response',
        data: {
          type: 'message',
          content: content,
          isPartial: !this.isComplete(content)
        }
      };
      if (socketSessionId) {
        payload.sessionId = socketSessionId;
      }
      this.ws.send(payload);

      this.lastSentTime = Date.now();
    }

    // Clear buffer
    this.buffer = '';
  }

  // Fix common formatting issues
  fixFormatting(content) {
    // First, protect code blocks from other formatting
    const codeBlocks = [];
    let protectedContent = content.replace(/```[\s\S]*?```/g, (match) => {
      const index = codeBlocks.length;
      codeBlocks.push(match);
      return `__CODE_BLOCK_${index}__`;
    });

    // Remove excessive line breaks (but not in code blocks)
    protectedContent = protectedContent.replace(/\n{4,}/g, '\n\n\n');

    // Fix list formatting
    protectedContent = protectedContent.replace(/(\d+\.\s+[^\n]+)\n\n+(\d+\.)/g, '$1\n$2');
    protectedContent = protectedContent.replace(/([-*]\s+[^\n]+)\n\n+([-*])/g, '$1\n$2');

    // Ensure proper spacing around headers
    protectedContent = protectedContent.replace(/\n{3,}(#{1,6}\s)/g, '\n\n$1');
    protectedContent = protectedContent.replace(/(#{1,6}\s[^\n]+)\n{3,}/g, '$1\n\n');

    // Restore code blocks
    codeBlocks.forEach((block, index) => {
      // Clean up the code block itself
      let cleanBlock = block;
      // Remove excessive newlines at the start and end of code blocks
      cleanBlock = cleanBlock.replace(/```(\w*)\n{2,}/g, '```$1\n');
      cleanBlock = cleanBlock.replace(/\n{2,}```/g, '\n```');

      protectedContent = protectedContent.replace(`__CODE_BLOCK_${index}__`, cleanBlock);
    });

    return protectedContent.trim();
  }

  // Check if content appears complete
  isComplete(content) {
    const trimmed = content.trim();

    // Check for completion indicators
    if (trimmed.endsWith('.') ||
      trimmed.endsWith('!') ||
      trimmed.endsWith('?') ||
      trimmed.endsWith('```')) {
      return true;
    }

    // Check for balanced code blocks
    const codeBlockCount = (trimmed.match(/```/g) || []).length;
    if (codeBlockCount > 0 && codeBlockCount % 2 !== 0) {
      return false;
    }

    return true;
  }

  // Force flush any remaining content
  forceFlush() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.buffer.length > 0) {
      this.flush();
    }
  }

  // Clean up
  destroy() {
    this.forceFlush();
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }
}

export default GeminiResponseHandler;
