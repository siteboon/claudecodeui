export function normalizeSessionTitleRename(currentTitle: string, requestedTitle: string | null): string | null {
  const trimmed = requestedTitle?.trim() ?? '';
  if (!trimmed || trimmed === currentTitle.trim()) {
    return null;
  }

  return trimmed;
}
