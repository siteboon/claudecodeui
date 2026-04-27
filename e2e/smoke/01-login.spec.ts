/**
 * Smoke spec 01 — App load + auth
 *
 * Visits `/`, completes the login/setup flow against the real form, and
 * asserts that the authenticated UI (project rail) is visible afterward.
 *
 * Single-user system: register on first run, login on subsequent runs.
 * The fixture handles both states (fresh DB → register; existing user → login).
 */

import { test, expect } from '@playwright/test';
import { ensureLoggedIn } from '../fixtures.js';

test('login flow completes and project rail is visible', async ({ page }) => {
  await ensureLoggedIn(page);

  // The project rail (fixed-width sidebar column) must be visible
  await expect(page.locator('.w-rail')).toBeVisible({ timeout: 10_000 });
});
