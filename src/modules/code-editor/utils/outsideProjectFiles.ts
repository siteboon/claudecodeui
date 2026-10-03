/**
 * Files outside the chat's project that the user agreed to open read-only.
 *
 * Kept for the life of the tab: confirming once per file is the warning; asking
 * again on every reopen would just be noise.
 */
const approvedPaths = new Set<string>();

/** Server error code for "outside the project, confirm to open read-only". */
export const OUTSIDE_PROJECT_CONFIRM = 'OUTSIDE_PROJECT_CONFIRM';

export function isOutsideFileApproved(filePath: string): boolean {
  return approvedPaths.has(filePath);
}

export function approveOutsideFile(filePath: string): void {
  approvedPaths.add(filePath);
}

/** Reads the error code from a failed file-tree response without consuming the caller's copy. */
export async function readFileTreeErrorCode(response: Response): Promise<string | null> {
  try {
    const data = await response.clone().json();
    if (typeof data?.code === 'string') return data.code;
    const raw = data?.error ?? data?.details;
    return raw && typeof raw === 'object' && typeof raw.code === 'string' ? raw.code : null;
  } catch {
    return null;
  }
}
