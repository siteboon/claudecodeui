/**
 * Detects if text contains at least one RTL (right-to-left) character
 * Checks for Arabic, Hebrew, and other RTL script characters
 *
 * @param {string} text - The text to analyze
 * @returns {boolean} - True if at least one RTL character is found
 */
export function hasRTLCharacters(text) {
  if (!text || typeof text !== 'string') {
    return false;
  }

  // RTL Unicode ranges:
  // Arabic: U+0600-U+06FF
  // Hebrew: U+0590-U+05FF
  // Arabic Supplement: U+0750-U+077F
  // Arabic Extended-A: U+08A0-U+08FF
  // Arabic Presentation Forms-A: U+FB50-U+FDFF
  // Arabic Presentation Forms-B: U+FE70-U+FEFF
  // Hebrew Presentation Forms: U+FB1D-U+FB4F
  const rtlRegex = /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB1D-\uFB4F\uFB50-\uFDFF\uFE70-\uFEFF]/;

  return rtlRegex.test(text);
}
