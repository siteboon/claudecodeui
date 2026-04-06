/**
 * @module ccud/pid
 * PID file management and orphan cleanup.
 */
import { writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { log, error } from './logger.js';

const PID_DIR = join(homedir(), '.ccud');
const PID_FILE = join(PID_DIR, 'ccud.pid');

export function writePidFile() {
  try {
    mkdirSync(PID_DIR, { recursive: true });
    writeFileSync(PID_FILE, String(process.pid), 'utf8');
    process.title = 'ccud';
    log(`PID ${process.pid} written to ${PID_FILE}`);
  } catch (e) {
    error(`Failed to write PID file: ${e.message}`);
  }
}

export function removePidFile() {
  try {
    unlinkSync(PID_FILE);
    log('PID file removed');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}
