/**
 * Detects when terminal output is sitting on a `sudo` password prompt so the
 * shell UI can surface a dedicated password popup instead of forcing the user
 * to type a hidden password straight into the terminal.
 *
 * STUB — returns false until the GREEN phase implements detection.
 */
export function isSudoPasswordPrompt(_text: string): boolean {
  return false;
}
