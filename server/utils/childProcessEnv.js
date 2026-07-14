// NODE_ENV=production leaks into child processes when process.env is spread or
// referenced directly, causing npm/npx tooling to silently skip devDependencies.
// Always build subprocess env through this helper instead of spreading process.env.
export function buildChildProcessEnv(extra = {}) {
  const { NODE_ENV, ...rest } = process.env;
  return { ...rest, ...extra };
}
