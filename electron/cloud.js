import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { safeStorage } from 'electron';

const CLOUD_API_TIMEOUT_MS = 15000;

function encryptSecret(secret) {
  if (!safeStorage.isEncryptionAvailable()) {
    return { encrypted: false, value: secret };
  }

  return {
    encrypted: true,
    value: safeStorage.encryptString(secret).toString('base64'),
  };
}

function decryptSecret(record) {
  if (!record?.value) return null;
  if (!record.encrypted) return record.value;
  try {
    return safeStorage.decryptString(Buffer.from(record.value, 'base64'));
  } catch {
    return null;
  }
}

export class CloudController {
  constructor({ storePath, controlPlaneUrl, callbackUrl, onChange }) {
    this.storePath = storePath;
    this.controlPlaneUrl = controlPlaneUrl;
    this.callbackUrl = callbackUrl;
    this.onChange = onChange;
    this.cloudAccount = null;
    this.cloudEnvironments = [];
    this.authState = 'logged_out';
  }

  getAccount() {
    return this.cloudAccount;
  }

  getAuthState() {
    return this.authState;
  }

  getEnvironments() {
    return this.cloudEnvironments;
  }

  getEnvironmentUrl(environment) {
    return environment.access_url || `https://${environment.subdomain}.cloudcli.ai`;
  }

  async getEnvironmentLaunchUrl(environment) {
    if (!environment?.id) {
      return this.getEnvironmentUrl(environment);
    }

    const data = await this.cloudApi(`/api/v1/environments/${encodeURIComponent(environment.id)}/launch`, {
      method: 'POST',
    });

    return data.launch_url || data.environment_url || this.getEnvironmentUrl(environment);
  }

  findEnvironment(environmentId) {
    return this.cloudEnvironments.find((item) => item.id === environmentId) || null;
  }

  async loadCloudAccount() {
    try {
      const raw = await fs.readFile(this.storePath, 'utf8');
      const stored = JSON.parse(raw);
      const apiKey = decryptSecret(stored.apiKey);
      this.cloudAccount = {
        deviceId: stored.deviceId || crypto.randomUUID(),
        email: stored.email || null,
        apiKey: apiKey || null,
      };
      this.authState = apiKey ? 'connected' : (stored.email ? 'expired' : 'logged_out');
      return this.cloudAccount;
    } catch {
      this.cloudAccount = {
        deviceId: crypto.randomUUID(),
        email: null,
        apiKey: null,
      };
      this.authState = 'logged_out';
      return this.cloudAccount;
    }
  }

  async saveCloudAccount(account) {
    const payload = {
      deviceId: account.deviceId || crypto.randomUUID(),
      email: account.email || null,
      apiKey: account.apiKey ? encryptSecret(account.apiKey) : null,
    };

    await fs.mkdir(path.dirname(this.storePath), { recursive: true });
    await fs.writeFile(this.storePath, JSON.stringify(payload, null, 2), 'utf8');
    this.cloudAccount = {
      deviceId: payload.deviceId,
      email: payload.email,
      apiKey: account.apiKey || null,
    };
    this.authState = account.apiKey ? 'connected' : 'logged_out';
    this.onChange?.();
    return this.cloudAccount;
  }

  async clearCloudAccount() {
    this.cloudAccount = {
      deviceId: crypto.randomUUID(),
      email: null,
      apiKey: null,
    };
    this.cloudEnvironments = [];
    this.authState = 'logged_out';
    await fs.rm(this.storePath, { force: true });
    this.onChange?.();
  }

  async invalidateCloudAccount() {
    this.cloudEnvironments = [];
    if (!this.cloudAccount) {
      this.cloudAccount = {
        deviceId: crypto.randomUUID(),
        email: null,
        apiKey: null,
      };
    } else {
      this.cloudAccount = {
        ...this.cloudAccount,
        apiKey: null,
      };
    }
    this.authState = this.cloudAccount.email ? 'expired' : 'logged_out';
    const payload = {
      deviceId: this.cloudAccount.deviceId,
      email: this.cloudAccount.email || null,
      apiKey: null,
    };
    await fs.mkdir(path.dirname(this.storePath), { recursive: true });
    await fs.writeFile(this.storePath, JSON.stringify(payload, null, 2), 'utf8');
    this.onChange?.();
  }

  async cloudApi(pathname, options = {}) {
    if (!this.cloudAccount?.apiKey) {
      throw new Error('Connect your CloudCLI account first.');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CLOUD_API_TIMEOUT_MS);
    let response;

    try {
      response = await fetch(`${this.controlPlaneUrl}${pathname}`, {
        ...options,
        signal: options.signal || controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.cloudAccount.apiKey,
          ...(options.headers || {}),
        },
      });
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error(`CloudCLI API request timed out after ${Math.round(CLOUD_API_TIMEOUT_MS / 1000)} seconds.`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        await this.invalidateCloudAccount();
      }
      throw new Error(body.error || `CloudCLI API request failed: ${response.status}`);
    }

    return body;
  }

  async refreshCloudEnvironments() {
    if (!this.cloudAccount?.apiKey) {
      this.cloudEnvironments = [];
      this.onChange?.();
      return [];
    }

    const data = await this.cloudApi('/api/v1/environments');
    this.cloudEnvironments = data.environments || [];
    this.onChange?.();
    return this.cloudEnvironments;
  }

  async startEnvironment(environment) {
    await this.cloudApi(`/api/v1/environments/${encodeURIComponent(environment.id)}/start`, {
      method: 'POST',
    });
  }

  async stopEnvironment(environment) {
    await this.cloudApi(`/api/v1/environments/${encodeURIComponent(environment.id)}/stop`, {
      method: 'POST',
    });
  }

  async getEnvironmentCredentials(environment) {
    return this.cloudApi(`/api/v1/environments/${encodeURIComponent(environment.id)}/credentials`);
  }

  async startEnvironmentAndWait(environment, timeoutMs) {
    await this.startEnvironment(environment);

    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const environments = await this.refreshCloudEnvironments();
      const current = environments.find((env) => env.id === environment.id);
      if (current?.status === 'running') {
        return current;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    throw new Error(`${environment.name} did not become ready in time.`);
  }

  buildConnectUrl() {
    if (!this.cloudAccount?.deviceId) {
      this.cloudAccount = {
        deviceId: crypto.randomUUID(),
        email: null,
        apiKey: null,
      };
    }

    const connectUrl = new URL('/auth/app-connect', this.controlPlaneUrl);
    connectUrl.searchParams.set('device_id', this.cloudAccount.deviceId);
    connectUrl.searchParams.set('callback_url', this.callbackUrl);
    connectUrl.searchParams.set('app_surface', 'cloudcli_desktop');
    connectUrl.searchParams.set('client_platform', 'desktop');
    return connectUrl.toString();
  }

  async saveFromCallback({ apiKey, email }) {
    await this.saveCloudAccount({
      deviceId: this.cloudAccount?.deviceId || crypto.randomUUID(),
      email,
      apiKey,
    });
    return this.cloudAccount;
  }
}
