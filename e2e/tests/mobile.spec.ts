/** Part 3: phone and small-tablet layouts — no sideways scroll, thumb-sized targets, sheets. */
import { expect, test, type Page } from '@playwright/test';
import { OWNER, login } from '../helpers';

const VIEWPORTS = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 844, height: 390 }, // landscape phone
];

async function noSidewaysScroll(page: Page, path: string) {
  await page.goto(path);
  // The app polls every 10s, so 'networkidle' never settles; wait for the route to render.
  await expect(page.locator('#main, main, h1').first()).toBeVisible();
  await page.waitForTimeout(600);
  const { scroll, inner } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    inner: window.innerWidth,
  }));
  expect(scroll, `${path} scrolls sideways`).toBeLessThanOrEqual(inner);
}

for (const vp of VIEWPORTS) {
  test(`no horizontal overflow at ${vp.width}×${vp.height}`, async ({ page }) => {
    await page.setViewportSize(vp);
    await noSidewaysScroll(page, '/welcome');
    await noSidewaysScroll(page, '/login');
    await login(page, OWNER);
    await page.goto('/');
    const room = await page.locator('a[href^="/rooms/"]').first().getAttribute('href');
    for (const p of ['/', '/map', room!, '/me', '/notifications']) await noSidewaysScroll(page, p);
  });
}

test('phone: bottom tab bar, 44px targets, 16px inputs, filter sheet with count', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, OWNER);
  await page.goto('/?minCapacity=8');
  const tabs = page.getByRole('navigation', { name: 'Main' }).getByRole('link');
  await expect(tabs.first()).toBeVisible();
  for (const box of await tabs.evaluateAll((as) => as.map((a) => a.getBoundingClientRect()))) {
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.bottom).toBeLessThanOrEqual(844);
  }
  const search = page.getByLabel('Describe the room you need, then press Enter');
  expect(await search.evaluate((el) => getComputedStyle(el).fontSize)).toBe('16px');

  const open = page.getByRole('button', { name: /^Filters/ });
  await expect(open).toContainText('1'); // the active-filter count badge
  expect((await open.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await open.click();
  const sheet = page.getByRole('form', { name: 'Filters' });
  await expect(sheet).toBeVisible();
  const box = (await sheet.boundingBox())!;
  expect(Math.round(box.y + box.height)).toBeGreaterThanOrEqual(840); // docked to the bottom
  await page.getByRole('button', { name: 'Show rooms' }).click();
  await expect(sheet).toBeHidden();
});

test('phone: reserve sheet docks to the bottom', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, OWNER);
  await page.goto('/');
  await page.locator('a[href^="/rooms/"]').first().click();
  await page.getByRole('button', { name: /^Reserve( a time)?$/ }).click();
  const sheet = page.getByRole('dialog', { name: /^Reserve / });
  await expect(sheet).toBeVisible();
  const box = (await sheet.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(389);
  expect(Math.round(box.y + box.height)).toBeGreaterThanOrEqual(843);
});
