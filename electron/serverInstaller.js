import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';

import spawn from 'cross-spawn';

/**
 * Installs the versioned local server runtime used by CloudCLI Desktop.
 *
 * Server bundles are cached under:
 *   ~/.cloudcli/server/<version>/dist-server/server/index.js
 */

const DEFAULT_INSTALL_ROOT = path.join(os.homedir(), '.cloudcli', 'server');
const DEFAULT_BUNDLE_BASE_URL = 'https://github.com/siteboon/claudecodeui/releases/download';
const MAX_REDIRECTS = 5;
const LOCAL_DOWNLOAD_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function mapArch(arch = process.arch) {
  return arch === 'arm64' ? 'arm64' : 'x64';
}

function mapPlatform(platform = process.platform) {
  if (platform === 'darwin') return 'mac';
  if (platform === 'win32') return 'win';
  return 'linux';
}

export class ServerInstaller {
  constructor({
    version,
    platform = process.platform,
    arch = process.arch,
    installRoot = process.env.CLOUDCLI_SERVER_DIR || DEFAULT_INSTALL_ROOT,
    bundleBaseUrl = process.env.CLOUDCLI_SERVER_BUNDLE_URL || DEFAULT_BUNDLE_BASE_URL,
    bundleReleaseTag = process.env.CLOUDCLI_SERVER_BUNDLE_RELEASE_TAG || '',
    onLog,
  } = {}) {
    if (!version) throw new Error('ServerInstaller requires the app version');
    this.version = version;
    this.platform = mapPlatform(platform);
    this.arch = mapArch(arch);
    this.installRoot = installRoot;
    this.bundleBaseUrl = bundleBaseUrl.replace(/\/+$/, '');
    this.bundleReleaseTag = bundleReleaseTag || `v${this.version}`;
    this.onLog = typeof onLog === 'function' ? onLog : () => {};
  }

  /** Directory the current version's server is (or will be) installed in. */
  getVersionDir() {
    return path.join(this.installRoot, this.version);
  }

  /** Absolute path to the server entry once installed. */
  getServerEntry() {
    return path.join(this.getVersionDir(), 'dist-server', 'server', 'index.js');
  }

  getBundleName() {
    return `cloudcli-local-server-${this.version}-${this.platform}-${this.arch}.tar.gz`;
  }

  getBundleUrl() {
    const url = new URL(`${this.bundleBaseUrl}/${this.bundleReleaseTag}/${this.getBundleName()}`);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOCAL_DOWNLOAD_HOSTS.has(url.hostname))) {
      throw new Error(`Refusing unsupported server bundle URL: ${url.toString()}`);
    }
    return url.toString();
  }

  log(line) {
    this.onLog(String(line));
  }

  async isInstalled() {
    try {
      const marker = JSON.parse(
        await fs.readFile(path.join(this.getVersionDir(), '.installed.json'), 'utf8'),
      );
      if (marker.version !== this.version) return false;
      await fs.access(this.getServerEntry());
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Ensures the server for this version is installed, downloading + extracting
   * it if needed. Returns the resolved server entry path.
   */
  async ensureInstalled() {
    if (await this.isInstalled()) {
      this.log(`Local server ${this.version} already installed.`);
      return this.getServerEntry();
    }

    const versionDir = this.getVersionDir();
    const tmpDir = path.join(this.installRoot, `.tmp-${this.version}-${process.pid}`);
    const archivePath = path.join(tmpDir, this.getBundleName());

    await fs.mkdir(tmpDir, { recursive: true });
    try {
      const url = this.getBundleUrl();
      this.log(`Downloading local server bundle…`);
      this.log(url);
      await this.#download(url, archivePath);
      await this.#verifyChecksum(url, archivePath);

      this.log('Extracting local server…');
      await fs.rm(versionDir, { recursive: true, force: true });
      await fs.mkdir(versionDir, { recursive: true });
      await this.#validateArchive(archivePath);
      await this.#extract(archivePath, versionDir);

      const entry = this.getServerEntry();
      await fs.access(entry);

      await fs.writeFile(
        path.join(versionDir, '.installed.json'),
        JSON.stringify({ version: this.version, installedAt: new Date().toISOString() }, null, 2),
        'utf8',
      );
      this.log(`Local server ${this.version} installed.`);
      return entry;
    } catch (error) {
      await fs.rm(versionDir, { recursive: true, force: true }).catch(() => {});
      throw new Error(`Failed to install local server: ${error.message}`);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  #download(url, destPath, redirectsLeft = MAX_REDIRECTS) {
    return new Promise((resolve, reject) => {
      const req = https.get(url, (res) => {
        const { statusCode, headers } = res;

        if (statusCode >= 300 && statusCode < 400 && headers.location) {
          res.resume();
          if (redirectsLeft <= 0) {
            reject(new Error('Too many redirects'));
            return;
          }
          const next = new URL(headers.location, url).toString();
          resolve(this.#download(next, destPath, redirectsLeft - 1));
          return;
        }

        if (statusCode !== 200) {
          res.resume();
          reject(new Error(`Download failed with HTTP ${statusCode}`));
          return;
        }

        const total = Number(headers['content-length']) || 0;
        let received = 0;
        let lastPct = -1;
        const out = createWriteStream(destPath);

        res.on('data', (chunk) => {
          received += chunk.length;
          if (total) {
            const pct = Math.floor((received / total) * 100);
            if (pct !== lastPct && pct % 10 === 0) {
              lastPct = pct;
              this.log(`Downloading… ${pct}%`);
            }
          }
        });
        res.pipe(out);
        out.on('finish', () => out.close(resolve));
        out.on('error', reject);
        res.on('error', reject);
      });
      req.on('error', reject);
    });
  }

  async #verifyChecksum(url, archivePath) {
    let expected;
    try {
      expected = (await this.#fetchText(`${url}.sha256`)).trim().split(/\s+/)[0];
    } catch (error) {
      throw new Error(`Could not verify server bundle checksum: ${error.message}`);
    }
    const actual = await this.#sha256(archivePath);
    if (expected.toLowerCase() !== actual.toLowerCase()) {
      throw new Error('Checksum mismatch — refusing to install');
    }
    this.log('Checksum verified.');
  }

  #fetchText(url, redirectsLeft = MAX_REDIRECTS) {
    return new Promise((resolve, reject) => {
      https
        .get(url, (res) => {
          const { statusCode, headers } = res;
          if (statusCode >= 300 && statusCode < 400 && headers.location) {
            res.resume();
            if (redirectsLeft <= 0) return reject(new Error('Too many redirects'));
            return resolve(this.#fetchText(new URL(headers.location, url).toString(), redirectsLeft - 1));
          }
          if (statusCode !== 200) {
            res.resume();
            return reject(new Error(`HTTP ${statusCode}`));
          }
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (c) => (body += c));
          res.on('end', () => resolve(body));
          res.on('error', reject);
        })
        .on('error', reject);
    });
  }

  #sha256(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = createReadStream(filePath);
      stream.on('data', (c) => hash.update(c));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  #extract(archivePath, destDir) {
    return new Promise((resolve, reject) => {
      const child = spawn('tar', ['-xzf', archivePath, '-C', destDir], {
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true,
      });
      let stderr = '';
      child.stderr?.on('data', (c) => (stderr += c));
      child.once('error', reject);
      child.once('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`tar exited with code ${code}: ${stderr.trim()}`));
      });
    });
  }

  #validateArchive(archivePath) {
    return new Promise((resolve, reject) => {
      const child = spawn('tar', ['-tzf', archivePath], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (c) => { stdout += c; });
      child.stderr?.on('data', (c) => { stderr += c; });
      child.once('error', reject);
      child.once('exit', (code) => {
        if (code !== 0) {
          reject(new Error(`tar list exited with code ${code}: ${stderr.trim()}`));
          return;
        }
        for (const entry of stdout.split(/\r?\n/).filter(Boolean)) {
          const normalized = entry.replace(/\\/g, '/');
          if (
            path.isAbsolute(normalized)
            || /^[a-zA-Z]:\//.test(normalized)
            || normalized.split('/').includes('..')
          ) {
            reject(new Error(`Refusing unsafe archive entry: ${entry}`));
            return;
          }
        }
        resolve();
      });
    });
  }
}
