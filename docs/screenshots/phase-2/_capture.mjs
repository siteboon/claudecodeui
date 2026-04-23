// Visual capture for Phase 2 review.
// Runs headless Chromium, navigates to the dev server, takes screenshots at
// 375x812 (iPhone 14) and 1440x900 (desktop). Also captures a Midnight demo
// reference for side-by-side fidelity comparison.
//
// Usage:
//   node docs/screenshots/phase-2/_capture.mjs
//
// Requires:
//   - dev server running at http://localhost:5188 (Vite + server on 3088)
//   - playwright installed (no-save dep) with chromium available

import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const APP_URL = process.env.DISPATCH_URL || 'http://localhost:5188';
const DEMO_URL = `file://${path.resolve(__dirname, '../../midnight/demo.html')}`;
const OUT = __dirname;

const DESKTOP = { name: 'desktop', viewport: { width: 1440, height: 900 } };
const MOBILE = { name: 'mobile', viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true };

async function screenshot(page, filePath, opts = {}) {
  const abs = path.join(OUT, filePath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await page.screenshot({ path: abs, fullPage: false, ...opts });
  console.log(`  saved ${filePath}`);
}

async function stabilize(page, ms = 600) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(ms);
}

async function ensureAuth(page) {
  // Only surface as "auth wall" if a login FORM is actually on screen (not
  // just the word "welcome" inside random copy). We pre-seed a valid token
  // via addInitScript so the login form should not be rendered.
  const loginForm = await page.$('form input[type="password"]').catch(() => null);
  if (loginForm) {
    console.log('  WARN: auth wall detected (password field present) — capturing auth view');
    return false;
  }
  return true;
}

async function captureApp({ name, viewport, isMobile, hasTouch }) {
  console.log(`\n=== ${name} (${viewport.width}x${viewport.height}) ===`);
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    isMobile: Boolean(isMobile),
    hasTouch: Boolean(hasTouch),
    colorScheme: 'dark',
  });
  const page = await context.newPage();

  // Pre-seed auth token so we land inside the app, not on the login screen.
  // The token is generated out-of-band and passed via DISPATCH_TOKEN.
  if (process.env.DISPATCH_TOKEN) {
    await context.addInitScript(
      (token) => localStorage.setItem('auth-token', token),
      process.env.DISPATCH_TOKEN,
    );
  }

  try {
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await stabilize(page, 1500);

    const proceed = await ensureAuth(page);
    if (!proceed) {
      await screenshot(page, `${name}/auth-wall.png`);
      await browser.close();
      return;
    }

    // Skip first-run onboarding wizard (Git Configuration → Connect Agents).
    // Click "Next"/"Finish" buttons until the main app view loads.
    for (let i = 0; i < 5; i++) {
      const nextBtn = await page
        .$('button:has-text("Next"), button:has-text("Finish"), button:has-text("Skip"), button:has-text("Continue")')
        .catch(() => null);
      if (!nextBtn) break;
      await nextBtn.click({ force: true }).catch(() => {});
      await stabilize(page, 500);
    }

    // Wait for the loading overlay to disappear and the tree to render.
    // The "Loading projects…" state is a div that goes away when getProjects
    // finishes scanning ~/.claude/projects.
    await page
      .waitForFunction(
        () => {
          const txt = document.body.innerText || '';
          return !txt.includes('Loading projects') && !txt.includes('Setting up your workspace');
        },
        { timeout: 45000 },
      )
      .catch(() => console.log('  (loading overlay still visible after 45s — capturing anyway)'));
    // Settle network
    await stabilize(page, 1500);
    await screenshot(page, `${name}/01-initial.png`);
    await screenshot(page, `${name}/02-sidebar-loaded.png`);

    // Desktop: click a project to expand if anything is visible
    if (name === 'desktop') {
      // Find a project row. SidebarProjectItem renders a chevron button on
      // the left; we target the FIRST inner button of the first
      // [data-topic-group-repo] container. First-project rows expand a
      // session list + reveal the Topic chip row.
      const firstProjectExpander = await page.$(
        '[data-topic-group-repo] button[aria-expanded="false"], [data-topic-group-repo] button:has(svg.lucide-chevron-right)',
      );
      if (firstProjectExpander) {
        await firstProjectExpander.click({ force: true }).catch(() => {});
        await stabilize(page, 800);
        await screenshot(page, `${name}/03-project-expanded.png`);
      } else {
        // Fallback: click the first project button inside the first group
        const fallback = await page.$('[data-topic-group-repo] button');
        if (fallback) {
          await fallback.click({ force: true }).catch(() => {});
          await stabilize(page, 800);
          await screenshot(page, `${name}/03-project-expanded.png`);
        }
      }
      // Try opening the topic creation UI (the "Topic +" chip)
      const topicPlus = await page.$('[role="tablist"][aria-label*="Topic" i] button:has(svg.lucide-plus)');
      if (topicPlus) {
        await topicPlus.click({ force: true }).catch(() => {});
        await stabilize(page, 300);
        await screenshot(page, `${name}/03b-topic-create.png`);
        await page.keyboard.press('Escape').catch(() => {});
      }

      // Screenshot the search scope disabled state
      const searchInput = await page.$('input[placeholder]');
      if (searchInput) {
        await searchInput.click();
        await screenshot(page, `${name}/04-search-empty-disabled.png`);
        await searchInput.type('repo');
        await stabilize(page, 400);
        await screenshot(page, `${name}/05-search-with-text.png`);
        // Clear
        await searchInput.evaluate((el) => { (el).value = ''; });
        await searchInput.press('Backspace');
      }
    }

    // Mobile: screenshot as-is. The sidebar is a sheet; the default view
    // should show the app + bottom tabbar.
    if (name === 'mobile') {
      await screenshot(page, `${name}/02-mobile-default.png`);
      // Open the sidebar sheet via the top-left hamburger menu. Different
      // fallbacks: aria-label, svg icon, or the bottom-tab "tree" icon.
      const menuBtn = await page
        .$('[aria-label*="menu" i], [aria-label*="sidebar" i], button:has(svg.lucide-menu), header button:first-of-type')
        .catch(() => null);
      if (menuBtn) {
        await menuBtn.click({ force: true }).catch(() => {});
        await stabilize(page, 600);
        await screenshot(page, `${name}/03-sidebar-sheet.png`);
        // Tap a repo group header (collapsible) to expand it
        const repoHeader = await page.$('button[aria-expanded]');
        if (repoHeader) {
          await repoHeader.click({ force: true }).catch(() => {});
          await stabilize(page, 400);
          await screenshot(page, `${name}/04-sheet-repo-expanded.png`);
        }
        // Screenshot search empty state
        const searchInput = await page.$('input[placeholder]');
        if (searchInput) {
          await searchInput.click({ force: true });
          await stabilize(page, 200);
          await screenshot(page, `${name}/05-sheet-search-focused.png`);
          await searchInput.type('auth');
          await stabilize(page, 300);
          await screenshot(page, `${name}/06-sheet-search-text.png`);
        }
      }
    }
  } catch (err) {
    console.error(`  FAIL ${name}:`, err.message);
  } finally {
    await browser.close();
  }
}

async function captureMidnightDemo() {
  console.log(`\n=== midnight demo reference ===`);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1800 }, colorScheme: 'dark' });
  await page.goto(DEMO_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await screenshot(page, `midnight-reference/demo.png`, { fullPage: true });
  await browser.close();
}

(async () => {
  await fs.mkdir(OUT, { recursive: true });
  await captureApp(DESKTOP);
  await captureApp(MOBILE);
  await captureMidnightDemo();
  console.log('\nDone.');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
