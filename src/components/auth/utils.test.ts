import assert from 'node:assert/strict';
import test from 'node:test';

import type { AuthViewState } from './utils';
import { classifyAuthProbe, resolveAuthView } from './utils';

const probe = (status: number, headers: Record<string, string> = {}) =>
  classifyAuthProbe(new Response(null, { status, headers }));

test('a successful probe authenticates', () => {
  assert.equal(probe(200), 'authenticated');
});

test('only the server marking the token bad ends the session', () => {
  assert.equal(probe(401, { 'X-Auth-Error': 'invalid-token' }), 'rejected');
  assert.equal(probe(403, { 'X-Auth-Error': 'invalid-token' }), 'rejected');
  assert.equal(probe(401, { 'X-Auth-Error': 'session-expired' }), 'rejected');
});

test('an unmarked 401/403 is a gateway verdict, not ours', () => {
  // authenticateToken() sets X-Auth-Error on every rejection it makes, so a
  // bare 401/403 came from in front of the app - Cloudflare Access answering an
  // unauthenticated fetch, a WAF, a proxy with its own auth. None of them looked
  // at this token, so none may end the session.
  assert.equal(probe(401), 'unavailable');
  assert.equal(probe(403), 'unavailable');
});

test('a non-auth error status is inconclusive, not a rejection', () => {
  // The reverse proxy in front of the server answers 502/503/504 while the
  // server restarts. None of these say anything about the stored token.
  assert.equal(probe(502), 'unavailable');
  assert.equal(probe(503), 'unavailable');
  assert.equal(probe(504), 'unavailable');
  assert.equal(probe(500), 'unavailable');
});

test('a 304 is inconclusive even though response.ok is false', () => {
  assert.equal(probe(304), 'unavailable');
});

test('the server auth-error header is honoured on an unexpected status', () => {
  assert.equal(probe(500, { 'X-Auth-Error': 'invalid-token' }), 'rejected');
});

const viewState = (overrides: Partial<AuthViewState> = {}): AuthViewState => ({
  isLoading: false,
  isPlatform: false,
  needsSetup: false,
  hasToken: true,
  hasUser: true,
  authUnavailable: false,
  hasCompletedOnboarding: true,
  ...overrides,
});

test('a verified session renders the app', () => {
  assert.equal(resolveAuthView(viewState()), 'app');
});

test('an unverifiable but held token shows the offline screen, not the login form', () => {
  // The regression: a cold-started PWA that could not reach the server still
  // holds a valid token, so demanding credentials would discard the session.
  assert.equal(
    resolveAuthView(viewState({ hasUser: false, hasToken: true, authUnavailable: true })),
    'unavailable',
  );
});

test('no token falls back to the login form even while unreachable', () => {
  assert.equal(
    resolveAuthView(viewState({ hasUser: false, hasToken: false, authUnavailable: true })),
    'login',
  );
});

test('a rejected session lands on the login form', () => {
  // clearSession() drops both the user and the token and clears the flag.
  assert.equal(
    resolveAuthView(viewState({ hasUser: false, hasToken: false, authUnavailable: false })),
    'login',
  );
});

test('loading takes precedence over an inconclusive check', () => {
  assert.equal(
    resolveAuthView(viewState({ isLoading: true, hasUser: false, authUnavailable: true })),
    'loading',
  );
});

test('setup takes precedence over an inconclusive check', () => {
  assert.equal(
    resolveAuthView(viewState({ needsSetup: true, hasUser: false, authUnavailable: true })),
    'setup',
  );
});

test('platform mode is unaffected by the new state', () => {
  assert.equal(
    resolveAuthView(viewState({ isPlatform: true, hasUser: false, authUnavailable: true })),
    'app',
  );
  assert.equal(
    resolveAuthView(viewState({ isPlatform: true, hasCompletedOnboarding: false })),
    'onboarding',
  );
});

test('onboarding still gates a verified session', () => {
  assert.equal(resolveAuthView(viewState({ hasCompletedOnboarding: false })), 'onboarding');
});
