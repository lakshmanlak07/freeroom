/** Part 5: the fox companion — follows, flips, celebrates, toggles, respects reduced motion. */
import { expect, test, type Page } from '@playwright/test';
import { OWNER, login } from '../helpers';

const fox = (page: Page) => page.getByTestId('fox-companion');
const center = async (page: Page) => {
  const b = (await fox(page).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

test('desktop: follows the cursor ~40px behind, faces it, never takes input', async ({ page }) => {
  await login(page, OWNER);
  await expect(fox(page)).toHaveAttribute('aria-hidden', 'true');
  expect(await fox(page).evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');

  await page.mouse.move(300, 400, { steps: 10 });
  await page.mouse.move(700, 450, { steps: 20 });
  await page.waitForTimeout(1500);
  const c = await center(page);
  const d = Math.hypot(c.x - 700, c.y - 450);
  expect(d).toBeGreaterThan(20);
  expect(d).toBeLessThan(80);
  await expect(fox(page)).toHaveAttribute('data-state', /hop|idle/);

  // Head left: the sprite flips.
  await page.mouse.move(200, 450, { steps: 20 });
  await expect
    .poll(() =>
      fox(page)
        .locator('> div')
        .evaluate((el) => el.style.transform),
    )
    .toBe('scaleX(-1)');
  await page.waitForTimeout(2600); // pointer still for > 2s
  await expect(fox(page)).toHaveAttribute('data-state', 'idle');

  await page.evaluate(() => window.dispatchEvent(new Event('freeroom:celebrate')));
  await expect(fox(page)).toHaveAttribute('data-state', 'celebrate');
});

test('toggle hides the fox and the choice survives a reload', async ({ page }) => {
  await login(page, OWNER);
  await expect(fox(page)).toBeVisible();
  const sw = page.getByRole('switch', { name: 'Fox companion' }).first();
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await sw.click();
  await expect(fox(page)).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('switch', { name: 'Fox companion' }).first()).toHaveAttribute(
    'aria-checked',
    'false',
  );
  await expect(fox(page)).toHaveCount(0);
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });
  test('the fox stays put', async ({ page }) => {
    await login(page, OWNER);
    const before = await fox(page).evaluate((el) => el.style.transform);
    await page.mouse.move(200, 200, { steps: 15 });
    await page.waitForTimeout(800);
    expect(await fox(page).evaluate((el) => el.style.transform)).toBe(before);
  });
});

test.describe('touch phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('off by default; when on it sits bottom-right above the tab bar', async ({ page }) => {
    await login(page, OWNER);
    await expect(fox(page)).toHaveCount(0);
    await page.goto('/me');
    await page.getByRole('switch', { name: 'Fox companion' }).last().tap();
    await expect(fox(page)).toBeVisible();
    await page.waitForTimeout(800);
    const c = await center(page);
    expect(c.x).toBeGreaterThan(300);
    expect(c.y).toBeGreaterThan(650);
    expect(c.y).toBeLessThan(790); // clear of the tab bar
  });
});
