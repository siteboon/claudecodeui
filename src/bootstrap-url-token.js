// Accept a one-time auth token handed in via the URL (?token=…) for reverse-proxy / tunnel / automation
// setups where access is already gated upstream (e.g. an ssh -L tunnel). Store it the same way a login
// does (localStorage['auth-token']), then strip it from the URL so it isn't left in history or shared
// links. Gated on no existing token; the backend already issues/verifies these JWTs (see /api/auth/*).
try {
  const u = new URL(window.location.href);
  const t = u.searchParams.get('token');
  if (t && !localStorage.getItem('auth-token')) {
    localStorage.setItem('auth-token', t);
    u.searchParams.delete('token');
    window.history.replaceState({}, '', u.pathname + u.search + u.hash);
  }
} catch (e) {
  /* non-fatal: never block app boot over a malformed URL */
}
