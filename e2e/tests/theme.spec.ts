/** Part 4: Light / Dark / System — toggle, persistence, OS following, and no light flash. */
import { expect, test, type Page } from '@playwright/test';
import { OWNER, login } from '../helpers';

const isDark = (page: Page) =>
  page.evaluate(() => document.documentElement.classList.contains('dark'));

test('toggle sets aria-pressed, applies html.dark, persists across reloads', async ({ page }) => {
  await login(page, OWNER);
  const theme = page.getByRole('group', { name: 'Theme' }).first();
  await theme.getByRole('button', { name: 'Dark' }).click();
  await expect(theme.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true');
  await expect(theme.getByRole('button', { name: 'Light' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  expect(await isDark(page)).toBe(true);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe('rgb(22, 19, 17)'); // #161311

  await page.reload();
  expect(await isDark(page)).toBe(true);
  await page
    .getByRole('group', { name: 'Theme' })
    .first()
    .getByRole('button', { name: 'Light' })
    .click();
  expect(await isDark(page)).toBe(false);
});

test.describe('System follows the OS', () => {
  test.use({ colorScheme: 'dark' });
  test('dark OS + System → dark; storage blocked does not break the app', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new Error('blocked');
        },
      });
    });
    await page.goto('/welcome');
    expect(await isDark(page)).toBe(true);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
});

test('no flash: html.dark is set by /theme-init.js before the app bundle runs', async ({
  page,
}) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('freeroom.theme', 'dark');
    } catch {
      /* storage blocked */
    }
  });
  // Block the app entirely: only the render-blocking init script can set the class.
  await page.route(/\/(src\/main\.tsx|assets\/index-[^/]+\.js)/, (r) => r.abort());
  await page.goto('/welcome');
  expect(await isDark(page)).toBe(true);
});
