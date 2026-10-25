// Remote access hardening used by the server entrypoint (TCP allowlist, login throttle, setup lock).
export {
  attachConnectionGuard,
  createLoginRateLimiter,
  isAllowedAddress,
  isRemoteEnabled,
  isTailscaleAddress,
  registerFromLoopbackOnly,
} from './remote-access.js';
