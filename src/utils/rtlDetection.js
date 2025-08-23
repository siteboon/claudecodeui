/**
 * RTL Detection Utilities
 * Provides functions to detect right-to-left text direction for proper display
 * of Hebrew, Arabic, and other RTL languages in mixed content.
 */

// RTL Unicode character ranges
const RTL_RANGES = [
  [0x0590, 0x05FF], // Hebrew
  [0x0600, 0x06FF], // Arabic
  [0x0700, 0x074F], // Syriac
  [0x0750, 0x077F], // Arabic Supplement
  [0x0780, 0x07BF], // Thaana
  [0x07C0, 0x07FF], // N'Ko
  [0x0800, 0x083F], // Samaritan
  [0x0840, 0x085F], // Mandaic
  [0x08A0, 0x08FF], // Arabic Extended-A
  [0xFB1D, 0xFB4F], // Hebrew Presentation Forms
  [0xFB50, 0xFDFF], // Arabic Presentation Forms-A
  [0xFE70, 0xFEFF], // Arabic Presentation Forms-B
  [0x10800, 0x1083F], // Cypriot Syllabary
  [0x10840, 0x1085F], // Imperial Aramaic
  [0x10860, 0x1087F], // Palmyrene
  [0x10880, 0x108AF], // Nabataean
  [0x108E0, 0x108FF], // Hatran
  [0x10900, 0x1091F], // Phoenician
  [0x10920, 0x1093F], // Lydian
  [0x10980, 0x1099F], // Meroitic Hieroglyphs
  [0x109A0, 0x109FF], // Meroitic Cursive
  [0x10A00, 0x10A5F], // Kharoshthi
  [0x10A60, 0x10A7F], // Old South Arabian
  [0x10A80, 0x10A9F], // Old North Arabian
  [0x10AC0, 0x10AFF], // Manichaean
  [0x10B00, 0x10B3F], // Avestan
  [0x10B40, 0x10B5F], // Inscriptional Parthian
  [0x10B60, 0x10B7F], // Inscriptional Pahlavi
  [0x10B80, 0x10BAF], // Psalter Pahlavi
  [0x10C00, 0x10C4F], // Old Turkic
  [0x10E60, 0x10E7F], // Rumi Numeral Symbols
  [0x1E800, 0x1E8DF], // Mende Kikakui
  [0x1E900, 0x1E95F], // Adlam
  [0x1EC70, 0x1ECBF], // Indic Siyaq Numbers
  [0x1ED00, 0x1ED4F], // Ottoman Siyaq Numbers
  [0x1EE00, 0x1EEFF], // Arabic Mathematical Alphabetic Symbols
];

// Special RTL control characters
const RTL_CONTROL_CHARS = [
  0x200F, // Right-to-Left Mark (RLM)
  0x202B, // Right-to-Left Embedding (RLE)
  0x202E, // Right-to-Left Override (RLO)
];

/**
 * Check if a character is RTL
 * @param {string} char - Single character to check
 * @returns {boolean} - True if character is RTL
 */
export function isRTLChar(char) {
  const code = char.codePointAt(0);
  
  // Check control characters first
  if (RTL_CONTROL_CHARS.includes(code)) {
    return true;
  }
  
  // Check RTL ranges
  return RTL_RANGES.some(([start, end]) => code >= start && code <= end);
}

/**
 * Check if a character is LTR (Latin, etc.)
 * @param {string} char - Single character to check
 * @returns {boolean} - True if character is LTR
 */
export function isLTRChar(char) {
  const code = char.codePointAt(0);
  
  // Basic Latin and Latin Extended ranges
  const LTR_RANGES = [
    [0x0041, 0x005A], // A-Z
    [0x0061, 0x007A], // a-z
    [0x00C0, 0x00FF], // Latin-1 Supplement
    [0x0100, 0x017F], // Latin Extended-A
    [0x0180, 0x024F], // Latin Extended-B
    [0x1E00, 0x1EFF], // Latin Extended Additional
  ];
  
  return LTR_RANGES.some(([start, end]) => code >= start && code <= end);
}

/**
 * Get the predominant direction of a text string
 * @param {string} text - Text to analyze
 * @returns {string} - 'rtl', 'ltr', or 'neutral'
 */
export function getTextDirection(text) {
  if (!text || typeof text !== 'string') {
    return 'neutral';
  }
  
  let rtlCount = 0;
  let ltrCount = 0;
  
  // Iterate through characters (handling surrogate pairs)
  for (const char of text) {
    if (isRTLChar(char)) {
      rtlCount++;
    } else if (isLTRChar(char)) {
      ltrCount++;
    }
  }
  
  // Determine predominant direction
  if (rtlCount > ltrCount) {
    return 'rtl';
  } else if (ltrCount > rtlCount) {
    return 'ltr';
  } else {
    return 'neutral';
  }
}

/**
 * Get the direction of the first strong directional character
 * This follows the HTML dir="auto" algorithm
 * @param {string} text - Text to analyze
 * @returns {string} - 'rtl' or 'ltr'
 */
export function getFirstStrongDirection(text) {
  if (!text || typeof text !== 'string') {
    return 'ltr';
  }
  
  // Find the first strong directional character
  for (const char of text) {
    if (isRTLChar(char)) {
      return 'rtl';
    } else if (isLTRChar(char)) {
      return 'ltr';
    }
  }
  
  return 'ltr'; // Default to LTR if no strong characters found
}

/**
 * Detect if text should be displayed RTL
 * Uses a combination of first strong character and predominant direction
 * @param {string} text - Text to analyze
 * @returns {boolean} - True if text should be displayed RTL
 */
export function shouldDisplayRTL(text) {
  if (!text || typeof text !== 'string') {
    return false;
  }
  
  // For very short text, use first strong character method
  if (text.length < 10) {
    return getFirstStrongDirection(text) === 'rtl';
  }
  
  // For longer text, use predominant direction
  const direction = getTextDirection(text);
  return direction === 'rtl';
}

/**
 * Get appropriate dir attribute value for HTML elements
 * @param {string} text - Text content
 * @returns {string} - 'rtl', 'ltr', or 'auto'
 */
export function getDirAttribute(text) {
  if (!text || typeof text !== 'string') {
    return 'ltr';
  }
  
  const direction = shouldDisplayRTL(text) ? 'rtl' : 'ltr';
  return direction;
}

/**
 * Check if text contains any RTL characters
 * @param {string} text - Text to check
 * @returns {boolean} - True if text contains RTL characters
 */
export function containsRTL(text) {
  if (!text || typeof text !== 'string') {
    return false;
  }
  
  for (const char of text) {
    if (isRTLChar(char)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Check if text contains mixed directional content
 * @param {string} text - Text to check
 * @returns {boolean} - True if text contains both RTL and LTR characters
 */
export function isMixedDirection(text) {
  if (!text || typeof text !== 'string') {
    return false;
  }
  
  let hasRTL = false;
  let hasLTR = false;
  
  for (const char of text) {
    if (isRTLChar(char)) {
      hasRTL = true;
    } else if (isLTRChar(char)) {
      hasLTR = true;
    }
    
    // Early exit if we found both
    if (hasRTL && hasLTR) {
      return true;
    }
  }
  
  return false;
}