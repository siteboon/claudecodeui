/**
 * Antigravity provider module barrel exports.
 */

export { AntigravityProvider } from './antigravity.provider.js';
export {
  getAntigravityBrainRoots,
  getAntigravityDataRoot,
  getAntigravityOauthTokenPath,
  getAntigravitySettingsPath,
  getAntigravitySummariesDbPath,
  getAntigravityTranscriptCandidates,
} from './antigravity-data-root.js';
export {
  fetchAntigravityQuota,
  resetAntigravityQuotaCache,
  type AntigravityQuotaBucket,
  type AntigravityQuotaGroup,
  type AntigravityQuotaData,
} from './antigravity-quota.provider.js';
