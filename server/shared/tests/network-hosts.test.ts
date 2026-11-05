import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getBindableHost, getConnectableHost } from '../../../shared/networkHosts.js';

/**
 * `getConnectableHost` produces a name for a human to read, `getBindableHost`
 * an address for a machine to connect to. The difference matters twice over:
 * `localhost` and `127.0.0.1` are separate browser origins, so anything stored
 * under one is invisible to the other, and `localhost` resolves to whichever
 * family the resolver prefers - which on Windows is `::1`, where an IPv4-bound
 * server is not listening.
 */

describe('getBindableHost', () => {
  it('maps every IPv4 loopback and wildcard to 127.0.0.1', () => {
    assert.equal(getBindableHost('0.0.0.0'), '127.0.0.1');
    assert.equal(getBindableHost('127.0.0.1'), '127.0.0.1');
    assert.equal(getBindableHost('localhost'), '127.0.0.1');
  });

  it('keeps IPv6 as IPv6, in brackets', () => {
    // A server bound to ::1 cannot be reached over IPv4 at all, so answering
    // 127.0.0.1 here would send the desktop app at a closed port.
    assert.equal(getBindableHost('::1'), '[::1]');
    assert.equal(getBindableHost('[::1]'), '[::1]');
    assert.equal(getBindableHost('::'), '[::1]');
  });

  it('brackets any other IPv6 literal', () => {
    assert.equal(getBindableHost('fe80::1'), '[fe80::1]');
    assert.equal(getBindableHost('[fe80::1]'), '[fe80::1]');
  });

  it('passes a real host through untouched', () => {
    assert.equal(getBindableHost('192.168.2.178'), '192.168.2.178');
    assert.equal(getBindableHost('example.local'), 'example.local');
  });

  it('falls back to the loopback for an empty host', () => {
    assert.equal(getBindableHost(''), '127.0.0.1');
    assert.equal(getBindableHost(undefined), '127.0.0.1');
  });

  it('differs from the display name exactly where it has to', () => {
    assert.equal(getConnectableHost('0.0.0.0'), 'localhost');
    assert.equal(getBindableHost('0.0.0.0'), '127.0.0.1');
  });
});
