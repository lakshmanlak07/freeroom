/** axe-core on the main pages (PRD §10): 0 serious or critical WCAG 2.2 AA violations, light and dark. */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { OWNER, login } from '../helpers';

async function audit(page: Page, path: string) {
  await page.goto(path);
  // Not 'networkidle': the app polls every 10–15 s and the map streams tiles.
  await expect(page.locator('main, [role="main"]').first()).toBeVisible();
  await page.waitForTimeout(1500);
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .exclude('.maplibregl-canvas') // WebGL canvas: the markers + buildings list are the accessible map
    .analyze();
  const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(
    serious.map(
      (v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
    ),
    `${path} has serious a11y violations`,
  ).toEqual([]);
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(theme, () => {
    test.use({ colorScheme: theme });
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((t) => {
        try {
          localStorage.setItem('freeroom.theme', t);
        } catch {
          /* storage blocked */
        }
      }, theme);
    });

    test('landing (signed out)', async ({ page }) => {
      await audit(page, '/welcome');
    });

    test('login', async ({ page }) => {
      await audit(page, '/login');
    });

    test.describe('signed in', () => {
      test.beforeEach(async ({ page }) => login(page, OWNER));
      test('search', async ({ page }) => audit(page, '/'));
      test('room timeline', async ({ page }) => {
        await page.goto('/');
        const href = await page.locator('a[href^="/rooms/"]').first().getAttribute('href');
        await audit(page, href!);
      });
      test('map', async ({ page }) => audit(page, '/map'));
      test('my reservations', async ({ page }) => audit(page, '/me'));
      test('notifications', async ({ page }) => audit(page, '/notifications'));
    });
  });
}
