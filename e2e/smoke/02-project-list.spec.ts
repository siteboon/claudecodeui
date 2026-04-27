/**
 * Smoke spec 02 — Project list
 *
 * Seeds a project via POST /api/projects/create-workspace before asserting,
 * so the spec is reliable on a clean test DB.
 *
 * ProjectRailItem renders a <button> inside the rail with a tooltip wrapping
 * it.  The rail itself has class `w-rail`; each project item button lives
 * inside a `.flex.h-full.w-rail` descendant.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect } from '@playwright/test';
import { ensureLoggedIn, TEST_USERNAME, TEST_PASSWORD } from '../fixtures.js';

test('at least one project appears in the rail within 3 s', async ({ page }) => {
  // Seed: create a real directory and register it as a project so the rail
  // always has at least one item, even on a fresh test DB.
  const seedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-smoke-02-'));

  // Log in via API to get a token for the seed request
  const loginRes = await page.request.post('/api/auth/login', {
    data: { username: TEST_USERNAME, password: TEST_PASSWORD },
  });
  // If login fails (first run), register first
  let token: string;
  if (loginRes.ok()) {
    token = (await loginRes.json()).token;
  } else {
    const regRes = await page.request.post('/api/auth/register', {
      data: { username: TEST_USERNAME, password: TEST_PASSWORD },
    });
    token = (await regRes.json()).token;
  }

  await page.request.post('/api/projects/create-workspace', {
    headers: { Authorization: `Bearer ${token}` },
    data: { workspaceType: 'existing', path: seedDir },
  });

  await ensureLoggedIn(page);

  // ProjectRailItem renders buttons inside the rail scroll area.
  // The "All projects" button is always present; individual project items are
  // siblings rendered by the map over railItems.
  const railButtons = page.locator('.w-rail button');

  // Wait up to 3 s for at least 2 buttons (AllProjects + ≥1 project item)
  await expect(railButtons.nth(1)).toBeVisible({ timeout: 3_000 });

  // Cleanup seed dir (best-effort)
  try { fs.rmdirSync(seedDir); } catch { /* ignore */ }
});
