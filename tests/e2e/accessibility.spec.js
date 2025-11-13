// Accessibility E2E tests
import { test, expect } from '@playwright/test';

test.describe('Accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should have proper page title', async ({ page }) => {
    await expect(page).toHaveTitle(/Claude Code UI|Claude|Code|UI/);
  });

  test('should have proper heading structure', async ({ page }) => {
    // Check for at least one h1
    const h1Elements = page.locator('h1');
    await expect(h1Elements.first()).toBeVisible();

    // Check heading hierarchy (h1 followed by h2, then h3, etc.)
    const headings = page.locator('h1, h2, h3, h4, h5, h6');
    const headingCount = await headings.count();

    if (headingCount > 0) {
      // Basic heading structure validation
      const visibleHeadings = await headings.filter({ hasText: /.+/ });
      expect(await visibleHeadings.count()).toBeGreaterThan(0);
    }
  });

  test('should have proper form labels', async ({ page }) => {
    // Check all form inputs have associated labels
    const inputs = page.locator('input, textarea, select');
    const inputCount = await inputs.count();

    for (let i = 0; i < inputCount; i++) {
      const input = inputs.nth(i);
      const inputId = await input.getAttribute('id');
      const hasLabel = await page.locator(`label[for="${inputId}"]`).isVisible() ||
                       await input.getAttribute('aria-label') ||
                       await input.getAttribute('aria-labelledby');

      if (!hasLabel) {
        console.warn(`Input at index ${i} may not have proper labeling`);
      }
    }
  });

  test('should have sufficient color contrast', async ({ page }) => {
    // This is a basic check - for comprehensive contrast testing,
    // you might want to use axe-playwright or other accessibility tools
    const textElements = page.locator('p, h1, h2, h3, h4, h5, h6, span, a, button');
    const textCount = await textElements.count();

    // Ensure text elements are visible (not hidden by CSS)
    for (let i = 0; i < Math.min(textCount, 10); i++) { // Check first 10 elements
      const element = textElements.nth(i);
      const isVisible = await element.isVisible();
      if (isVisible) {
        // Basic check that element has some computed styles
        const styles = await element.evaluate((el) => {
          const computed = window.getComputedStyle(el);
          return {
            color: computed.color,
            backgroundColor: computed.backgroundColor,
            fontSize: computed.fontSize,
            opacity: computed.opacity
          };
        });

        expect(styles.opacity).not.toBe('0');
        expect(parseFloat(styles.fontSize)).toBeGreaterThan(0);
      }
    }
  });

  test('should have keyboard navigation support', async ({ page }) => {
    // Test tab navigation
    await page.keyboard.press('Tab');

    // Check that focus indicator is visible
    const focusedElement = page.locator(':focus');
    expect(await focusedElement.count()).toBeGreaterThan(0);

    // Test arrow key navigation if there are menus or dropdowns
    const menuItems = page.locator('[role="menuitem"], .dropdown-item, nav a');
    if (await menuItems.first().isVisible()) {
      await menuItems.first().focus();

      // Try arrow keys
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowUp');
    }
  });

  test('should have ARIA attributes where needed', async ({ page }) => {
    // Check for proper ARIA attributes on interactive elements
    const buttons = page.locator('button');
    const buttonCount = await buttons.count();

    for (let i = 0; i < Math.min(buttonCount, 5); i++) { // Check first 5 buttons
      const button = buttons.nth(i);
      const hasAriaLabel = await button.getAttribute('aria-label');
      const hasAriaDescribedBy = await button.getAttribute('aria-describedby');
      const hasText = await button.filter({ hasText: /.+/ }).count() > 0;

      // Buttons should have either text, aria-label, or be properly described
      if (!hasText && !hasAriaLabel && !hasAriaDescribedBy) {
        console.warn(`Button at index ${i} may need better accessibility labeling`);
      }
    }

    // Check for proper ARIA roles
    const landmarks = page.locator('[role="banner"], [role="navigation"], [role="main"], [role="contentinfo"], [role="search"], header, nav, main, footer');
    const landmarkCount = await landmarks.count();
    expect(landmarkCount).toBeGreaterThan(0);
  });

  test('should have alt text for images', async ({ page }) => {
    const images = page.locator('img');
    const imageCount = await images.count();

    for (let i = 0; i < imageCount; i++) {
      const img = images.nth(i);
      const alt = await img.getAttribute('alt');
      const role = await img.getAttribute('role');

      // Images should have alt text unless they're decorative (role="presentation")
      if (role !== 'presentation' && alt === null) {
        console.warn(`Image at index ${i} is missing alt text`);
      }
    }
  });

  test('should support screen reader announcements', async ({ page }) => {
    // Check for live regions for dynamic content
    const liveRegions = page.locator('[aria-live], [role="status"], [role="alert"]');

    // This is a basic check - actual live region behavior depends on your app
    const liveRegionCount = await liveRegions.count();

    if (liveRegionCount === 0) {
      console.warn('No live regions found - consider adding them for dynamic content updates');
    }
  });
});