// ANSI escape code parser for terminal output
export function parseAnsi(text) {
  const ansiRegex = /\x1b\[[0-9;]*m/g;
  
  // Extract plain text without ANSI codes
  const plainText = text.replace(ansiRegex, '');
  
  // Parse ANSI codes for colors and formatting
  const segments = [];
  let lastIndex = 0;
  let currentStyle = {
    color: null,
    background: null,
    bold: false,
    italic: false,
    underline: false
  };
  
  // Find all ANSI sequences
  let match;
  while ((match = ansiRegex.exec(text)) !== null) {
    // Add text before this ANSI code
    if (match.index > lastIndex) {
      segments.push({
        text: text.substring(lastIndex, match.index),
        style: { ...currentStyle }
      });
    }
    
    // Parse ANSI code
    const codes = match[0].slice(2, -1).split(';').map(Number);
    
    for (const code of codes) {
      switch (code) {
        case 0: // Reset
          currentStyle = {
            color: null,
            background: null,
            bold: false,
            italic: false,
            underline: false
          };
          break;
        case 1: currentStyle.bold = true; break;
        case 3: currentStyle.italic = true; break;
        case 4: currentStyle.underline = true; break;
        case 22: currentStyle.bold = false; break;
        case 23: currentStyle.italic = false; break;
        case 24: currentStyle.underline = false; break;
        
        // Foreground colors
        case 30: currentStyle.color = 'black'; break;
        case 31: currentStyle.color = 'red'; break;
        case 32: currentStyle.color = 'green'; break;
        case 33: currentStyle.color = 'yellow'; break;
        case 34: currentStyle.color = 'blue'; break;
        case 35: currentStyle.color = 'magenta'; break;
        case 36: currentStyle.color = 'cyan'; break;
        case 37: currentStyle.color = 'white'; break;
        case 39: currentStyle.color = null; break;
        
        // Background colors
        case 40: currentStyle.background = 'black'; break;
        case 41: currentStyle.background = 'red'; break;
        case 42: currentStyle.background = 'green'; break;
        case 43: currentStyle.background = 'yellow'; break;
        case 44: currentStyle.background = 'blue'; break;
        case 45: currentStyle.background = 'magenta'; break;
        case 46: currentStyle.background = 'cyan'; break;
        case 47: currentStyle.background = 'white'; break;
        case 49: currentStyle.background = null; break;
      }
    }
    
    lastIndex = match.index + match[0].length;
  }
  
  // Add remaining text
  if (lastIndex < text.length) {
    segments.push({
      text: text.substring(lastIndex),
      style: { ...currentStyle }
    });
  }
  
  return {
    plainText,
    segments,
    hasAnsi: ansiRegex.test(text)
  };
}

// Convert ANSI styled segments to HTML
export function ansiToHtml(segments) {
  return segments.map(segment => {
    const styles = [];
    
    if (segment.style.color) {
      styles.push(`color: var(--ansi-${segment.style.color})`);
    }
    if (segment.style.background) {
      styles.push(`background-color: var(--ansi-bg-${segment.style.background})`);
    }
    if (segment.style.bold) {
      styles.push('font-weight: bold');
    }
    if (segment.style.italic) {
      styles.push('font-style: italic');
    }
    if (segment.style.underline) {
      styles.push('text-decoration: underline');
    }
    
    const styleStr = styles.length > 0 ? ` style="${styles.join('; ')}"` : '';
    const escapedText = segment.text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
    
    return `<span${styleStr}>${escapedText}</span>`;
  }).join('');
}

// Extract meaningful information from terminal output
export function extractTerminalInfo(text) {
  const info = {
    progress: null,
    status: null,
    errors: [],
    warnings: [],
    files: [],
    commands: []
  };
  
  const lines = text.split('\n');
  
  for (const line of lines) {
    // Progress detection
    const progressMatch = line.match(/(\d+)%/);
    if (progressMatch) {
      info.progress = parseInt(progressMatch[1]);
    }
    
    // Status indicators
    if (line.includes('✓') || line.includes('✅')) {
      info.status = 'success';
    } else if (line.includes('✗') || line.includes('❌')) {
      info.status = 'error';
    } else if (line.includes('⚠') || line.includes('⚠️')) {
      info.status = 'warning';
    }
    
    // File paths
    const fileMatch = line.match(/[\/\w\-\.]+\.(js|jsx|ts|tsx|py|java|go|rs|cpp|c|h|css|html|json|md)/g);
    if (fileMatch) {
      info.files.push(...fileMatch);
    }
    
    // Commands
    const cmdMatch = line.match(/^\$\s+(.+)$/);
    if (cmdMatch) {
      info.commands.push(cmdMatch[1]);
    }
    
    // Errors and warnings
    if (line.toLowerCase().includes('error:')) {
      info.errors.push(line);
    } else if (line.toLowerCase().includes('warning:')) {
      info.warnings.push(line);
    }
  }
  
  return info;
}