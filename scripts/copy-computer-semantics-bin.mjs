#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const sourceDir = path.join(rootDir, 'server', 'modules', 'computer-use', 'semantics', 'bin');
const targetDir = path.join(rootDir, 'dist-server', 'server', 'modules', 'computer-use', 'semantics', 'bin');

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

if (await pathExists(sourceDir)) {
  await fs.mkdir(path.dirname(targetDir), { recursive: true });
  await fs.cp(sourceDir, targetDir, { recursive: true });
  console.log(`Copied Computer Use semantic helpers to ${path.relative(rootDir, targetDir)}`);
}
