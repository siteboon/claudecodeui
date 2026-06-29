#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const platform = process.env.CLOUDCLI_SEMANTICS_PLATFORM || process.platform;
const arch = process.env.CLOUDCLI_SEMANTICS_ARCH || process.arch;
const platformArch = `${platform}-${arch}`;
const semanticsRoot = path.join(rootDir, 'server', 'modules', 'computer-use', 'semantics');
const outDir = path.join(semanticsRoot, 'bin', platformArch);
const requireBuild = process.env.CLOUDCLI_SEMANTICS_BUILD_REQUIRED === '1';

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      ...options,
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

function commandExists(command) {
  return new Promise((resolve) => {
    const child = spawn(command, ['--version'], {
      stdio: 'ignore',
      shell: process.platform === 'win32',
    });
    child.once('error', () => resolve(false));
    child.once('exit', (code) => resolve(code === 0));
  });
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function isUpToDate(output, inputs) {
  if (!(await pathExists(output))) {
    return false;
  }

  const outputStat = await fs.stat(output);
  for (const input of inputs) {
    const inputStat = await fs.stat(input);
    if (inputStat.mtimeMs > outputStat.mtimeMs) {
      return false;
    }
  }
  return true;
}

async function ensureCommand(command, helpText) {
  if (await commandExists(command)) {
    return true;
  }

  const message = `${command} was not found. ${helpText}`;
  if (requireBuild) {
    throw new Error(message);
  }
  console.log(`Skipping semantic helper build: ${message}`);
  return false;
}

if (platform === 'darwin') {
  const source = path.join(semanticsRoot, 'helpers', 'macos', 'CloudCLISemantics.swift');
  const output = path.join(outDir, 'CloudCLISemantics');

  if (!(await ensureCommand('swiftc', 'Install Xcode Command Line Tools to compile the macOS helper.'))) {
    process.exit(0);
  }
  if (await isUpToDate(output, [source])) {
    console.log(`Semantic helper is up to date: ${path.relative(rootDir, output)}`);
    process.exit(0);
  }

  await fs.mkdir(outDir, { recursive: true });
  await run('swiftc', [
    source,
    '-o',
    output,
    '-framework',
    'AppKit',
    '-framework',
    'ApplicationServices',
  ]);
  await fs.chmod(output, 0o755);
  console.log(`Built ${path.relative(rootDir, output)}`);
} else if (platform === 'win32') {
  const project = path.join(semanticsRoot, 'helpers', 'windows', 'CloudCLISemantics.csproj');
  const source = path.join(semanticsRoot, 'helpers', 'windows', 'Program.cs');
  const output = path.join(outDir, 'CloudCLISemantics.exe');

  if (!(await ensureCommand('dotnet', '.NET SDK is required to compile the Windows helper.'))) {
    process.exit(0);
  }
  if (await isUpToDate(output, [project, source])) {
    console.log(`Semantic helper is up to date: ${path.relative(rootDir, output)}`);
    process.exit(0);
  }

  await fs.mkdir(outDir, { recursive: true });
  await run('dotnet', [
    'publish',
    project,
    '-c',
    'Release',
    '-r',
    arch === 'arm64' ? 'win-arm64' : 'win-x64',
    '--self-contained',
    'false',
    '-p:PublishSingleFile=true',
    '-o',
    outDir,
  ]);
  console.log(`Built ${path.relative(rootDir, output)}`);
} else {
  console.log(`Semantic helper build is not supported for ${platform}-${arch}.`);
}
