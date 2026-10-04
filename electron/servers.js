import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

// Self-hosted CloudCLI servers the user added by address (a home server, a VPS, ...).
// They open as desktop tabs like Local CloudCLI and cloud environments do.

const PROBE_PATH = '/api/auth/status';
const PROBE_TIMEOUT_MS = 8000;
const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;

function isWebProtocol(protocol) {
  return protocol === 'http:' || protocol === 'https:';
}

/**
 * Turns what the user typed ("192.168.1.20:3001", "https://cloudcli.example.com/") into the
 * server URL the app stores and loads: origin plus an optional path, without query, hash or
 * trailing slash. A bare host[:port] is assumed to be http. Error messages are shown as-is.
 */
export function normalizeServerUrl(input) {
  const raw = String(input ?? '').trim();
  if (!raw) {
    throw new Error('Enter the address of a CloudCLI server, for example http://192.168.1.20:3001.');
  }

  let parsed;
  try {
    parsed = new URL(SCHEME_PATTERN.test(raw) ? raw : `http://${raw}`);
  } catch {
    throw new Error(`"${raw}" is not a valid server address.`);
  }

  if (!isWebProtocol(parsed.protocol)) {
    throw new Error('Only http:// and https:// server addresses are supported.');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Remove the username and password from the address and sign in on the server instead.');
  }

  const pathname = parsed.pathname.replace(/\/+$/, '');
  return {
    url: `${parsed.origin}${pathname}`,
    origin: parsed.origin,
    name: parsed.host,
  };
}

/** True for the body of a CloudCLI `GET /api/auth/status` response. */
export function isCloudCliAuthStatus(value) {
  return Boolean(value) && typeof value === 'object' && typeof value.needsSetup === 'boolean';
}

/**
 * Checks that a CloudCLI server answers at `serverUrl` before it is saved, so a typo or an
 * unreachable host gets a clear error instead of a blank tab.
 */
export async function probeServer(serverUrl, { fetchImpl = fetch, timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  const { url, name } = normalizeServerUrl(serverUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  let body = '';

  try {
    response = await fetchImpl(`${url}${PROBE_PATH}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    body = await response.text();
  } catch (error) {
    const reason = controller.signal.aborted
      ? `no response after ${Math.round(timeoutMs / 1000)} seconds`
      : (error?.message || String(error));
    throw new Error(`Could not reach ${name} (${reason}). Check the address and that the server is running and reachable from this computer.`);
  } finally {
    clearTimeout(timeout);
  }

  let status = null;
  try {
    status = JSON.parse(body);
  } catch {
    // Not JSON, so not a CloudCLI server; reported below.
  }

  if (!response.ok || !isCloudCliAuthStatus(status)) {
    const httpStatus = response.ok ? '' : ` with HTTP ${response.status}`;
    throw new Error(`${name} responded${httpStatus}, but it does not look like a CloudCLI server.`);
  }

  return status;
}

/**
 * What a server tab may do with a navigation or window.open target: stay on the saved
 * origin ('allow'), hand a web link to the default browser ('external'), or drop it
 * ('block'). Non-web schemes are never passed on to the OS from a user-entered origin.
 */
export function classifyServerNavigation(url, allowedOrigin) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return 'block';
  }
  if (allowedOrigin && parsed.origin === allowedOrigin) return 'allow';
  return isWebProtocol(parsed.protocol) ? 'external' : 'block';
}

function sanitizeStoredServer(entry) {
  if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || !entry.id) return null;
  try {
    const { url, name } = normalizeServerUrl(entry.url);
    return {
      id: entry.id,
      name,
      url,
      addedAt: typeof entry.addedAt === 'string' ? entry.addedAt : null,
    };
  } catch {
    return null;
  }
}

export class ServersController {
  constructor({ storePath, fetchImpl, probeTimeoutMs, onChange }) {
    this.storePath = storePath;
    this.fetchImpl = fetchImpl;
    this.probeTimeoutMs = probeTimeoutMs;
    this.onChange = onChange;
    this.servers = [];
  }

  getServers() {
    return this.servers;
  }

  findServer(serverId) {
    return this.servers.find((server) => server.id === serverId) || null;
  }

  getOrigins() {
    return this.servers.map((server) => new URL(server.url).origin);
  }

  async load() {
    try {
      const stored = JSON.parse(await fs.readFile(this.storePath, 'utf8'));
      const entries = Array.isArray(stored?.servers) ? stored.servers : [];
      this.servers = entries.map(sanitizeStoredServer).filter(Boolean);
    } catch {
      this.servers = [];
    }
    return this.servers;
  }

  async save(servers) {
    await fs.mkdir(path.dirname(this.storePath), { recursive: true });
    await fs.writeFile(this.storePath, JSON.stringify({ servers }, null, 2), 'utf8');
    this.servers = servers;
    this.onChange?.();
  }

  /** Validates, probes and saves an address. Adding a saved address again returns the saved entry. */
  async addServer(address) {
    const { url, name } = normalizeServerUrl(address);
    const findSaved = () => this.servers.find((server) => server.url === url) || null;
    if (findSaved()) return findSaved();

    await probeServer(url, { fetchImpl: this.fetchImpl, timeoutMs: this.probeTimeoutMs });
    // The same address may have been saved while the probe was in flight.
    if (findSaved()) return findSaved();

    const server = { id: crypto.randomUUID(), name, url, addedAt: new Date().toISOString() };
    await this.save([...this.servers, server]);
    return server;
  }

  async removeServer(serverId) {
    const server = this.findServer(serverId);
    if (!server) return null;
    await this.save(this.servers.filter((item) => item.id !== serverId));
    return server;
  }
}
