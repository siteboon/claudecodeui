import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { extractCwdFromFirstBytes } from '../projects.js';

describe('extractCwdFromFirstBytes', () => {
  let testDir;

  beforeAll(async () => {
    // Create a temporary directory for test files
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-test-'));
  });

  afterAll(async () => {
    // Clean up test directory
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('cwd found within 100KB', () => {
    test('returns cwd from first line', async () => {
      const testFile = path.join(testDir, 'first-line.jsonl');
      const cwdValue = '/home/user/my-project';
      await fs.writeFile(
        testFile,
        `{"type":"user","cwd":"${cwdValue}","timestamp":"2024-01-01T00:00:00Z"}\n`
      );

      const result = await extractCwdFromFirstBytes(testFile);
      expect(result).toBe(cwdValue);
    });

    test('returns cwd from third line', async () => {
      const testFile = path.join(testDir, 'third-line.jsonl');
      const cwdValue = '/home/user/my-project';
      const lines = [
        '{"type":"start","timestamp":"2024-01-01T00:00:00Z"}',
        '{"type":"metadata","sessionId":"abc123"}',
        `{"type":"user","cwd":"${cwdValue}","timestamp":"2024-01-01T00:00:01Z"}`,
        '{"type":"assistant","content":"Hello"}'
      ];
      await fs.writeFile(testFile, lines.join('\n') + '\n');

      const result = await extractCwdFromFirstBytes(testFile);
      expect(result).toBe(cwdValue);
    });

    test('returns cwd from small file', async () => {
      const testFile = path.join(testDir, 'small-file.jsonl');
      const cwdValue = '/workspace/test-project';
      await fs.writeFile(
        testFile,
        `{"cwd":"${cwdValue}"}\n`
      );

      const result = await extractCwdFromFirstBytes(testFile);
      expect(result).toBe(cwdValue);
    });
  });

  describe('cwd not found within 100KB', () => {
    test('returns null when cwd after 100KB', async () => {
      const testFile = path.join(testDir, 'large-file.jsonl');
      const cwdValue = '/home/user/my-project';

      // Create file with 100KB of data without cwd, then cwd after
      const line = '{"type":"message","content":"' + 'x'.repeat(900) + '"}\n';
      const linesNeeded = Math.ceil(100 * 1024 / line.length) + 10;
      const lines = Array(linesNeeded).fill(line);
      lines.push(`{"cwd":"${cwdValue}"}\n`);

      await fs.writeFile(testFile, lines.join(''));

      const result = await extractCwdFromFirstBytes(testFile);
      expect(result).toBeNull();
    });

    test('returns null when no cwd field', async () => {
      const testFile = path.join(testDir, 'no-cwd.jsonl');
      await fs.writeFile(
        testFile,
        '{"type":"message","content":"test"}\n'
      );

      const result = await extractCwdFromFirstBytes(testFile);
      expect(result).toBeNull();
    });

    test('returns null for empty file', async () => {
      const testFile = path.join(testDir, 'empty.jsonl');
      await fs.writeFile(testFile, '');

      const result = await extractCwdFromFirstBytes(testFile);
      expect(result).toBeNull();
    });
  });

  describe('malformed JSON at byte boundary', () => {
    test('handles truncated JSON line gracefully', async () => {
      const testFile = path.join(testDir, 'truncated.jsonl');
      const cwdValue = '/home/user/project';

      // Create file where last line before 100KB is truncated
      const validLine = `{"cwd":"${cwdValue}"}\n`;
      const largeLine = '{"type":"message","content":"' + 'x'.repeat(100 * 1024) + '"}\n';

      await fs.writeFile(testFile, validLine + largeLine);

      // Should find cwd from first valid line
      const result = await extractCwdFromFirstBytes(testFile);
      expect(result).toBe(cwdValue);
    });

    test('ignores malformed line and continues', async () => {
      const testFile = path.join(testDir, 'malformed.jsonl');
      const cwdValue = '/home/user/project';
      const lines = [
        '{"invalid json}',
        `{"cwd":"${cwdValue}"}`,
        '{"type":"message"}'
      ];
      await fs.writeFile(testFile, lines.join('\n') + '\n');

      const result = await extractCwdFromFirstBytes(testFile);
      expect(result).toBe(cwdValue);
    });
  });

  describe('implementation details', () => {
    test('stops reading after finding cwd', async () => {
      const testFile = path.join(testDir, 'early-exit.jsonl');
      const cwdValue1 = '/first/project';
      const cwdValue2 = '/second/project';
      const lines = [
        `{"cwd":"${cwdValue1}","timestamp":"2024-01-01T00:00:00Z"}`,
        '{"type":"message","content":"test"}',
        `{"cwd":"${cwdValue2}","timestamp":"2024-01-01T00:00:01Z"}`
      ];
      await fs.writeFile(testFile, lines.join('\n') + '\n');

      // Should return the first cwd found
      const result = await extractCwdFromFirstBytes(testFile);
      expect(result).toBe(cwdValue1);
    });

    test('respects 100KB byte limit exactly', async () => {
      const testFile = path.join(testDir, 'exact-limit.jsonl');

      // Create a file that's exactly at the byte boundary
      const maxBytes = 100 * 1024;
      const padding = 'x'.repeat(900);
      const line = `{"type":"msg","data":"${padding}"}\n`;

      let content = '';
      while (content.length < maxBytes) {
        content += line;
      }

      // Add cwd right at the boundary
      content += `{"cwd":"/boundary/project"}\n`;

      await fs.writeFile(testFile, content);

      // Should not find cwd because it's past 100KB
      const result = await extractCwdFromFirstBytes(testFile);
      expect(result).toBeNull();
    });
  });
});
