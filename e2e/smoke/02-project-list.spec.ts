/**
 * Smoke spec 02 — Project list
 *
 * After auth, asserts that at least one project is visible in the project rail
 * within 3 seconds.
 *
 * ProjectRailItem renders a <button> inside the rail with a tooltip wrapping
 * it.  The rail itself has class `w-rail`; each project item button lives
 * inside a `.flex.h-full.w-rail` descendant.
 */

import { test, expect } from '@playwright/test';
import { ensureLoggedIn } from '../fixtures.js';

test('at least one project appears in the rail within 3 s', async ({ page }) => {
  await ensureLoggedIn(page);

  // ProjectRailItem renders buttons inside the rail scroll area.
  // The "All projects" button is always present; individual project items are
  // siblings rendered by the map over railItems.  We look for any button
  // inside the rail that has an aria-label set by the Tooltip (its content
  // prop is the project display name), or simply count descendants > 1
  // (AllProjects + at least one project item).
  //
  // A cleaner selector: the rail scroll area children buttons.
  // ScrollArea inside ProjectRail wraps the visibleItems map output.
  const railButtons = page.locator('.w-rail button');

  // Wait up to 3 s for at least 2 buttons (AllProjects + ≥1 project item)
  await expect(railButtons.nth(1)).toBeVisible({ timeout: 3_000 });
});
