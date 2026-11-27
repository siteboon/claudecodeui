/**
 * Reads the running build's version for the server entrypoint and health
 * response. Versioned deployments retain a stable application root, whose
 * package.json can belong to an unrelated source checkout; compiled metadata
 * therefore takes precedence. Source runs and older builds fall back to the
 * package version. The entrypoint captures this value once at startup.
 */
export function readRunningApplicationVersion(dependencies: {
  buildMetadataPath: string;
  packageJsonPath: string;
  readTextFile(filePath: string): string;
}): string | null {
  for (const filePath of [dependencies.buildMetadataPath, dependencies.packageJsonPath]) {
    try {
      const metadata = JSON.parse(dependencies.readTextFile(filePath)) as { version?: unknown };
      if (typeof metadata.version === 'string' && metadata.version.trim()) {
        return metadata.version.trim();
      }
    } catch {
      // A source run has no compiled metadata, and missing package metadata
      // must not prevent the existing health endpoint from starting.
    }
  }
  return null;
}
