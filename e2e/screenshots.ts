/** Re-capture docs/screenshots/*.png from the current UI at 1440×900 (local stack, dev sign-in). */
import { chromium, expect } from '@playwright/test';
import { login } from './helpers';

const BASE = process.env.BASE_URL ?? 'http://localhost:5174';
const OUT = '../docs/screenshots';
const browser = await chromium.launch();
const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const day = (plus: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(
    new Date(Date.now() + plus * 86_400_000),
  );
const shot = async (name: string) => {
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/${name}.png` });
};

await page.goto('/welcome');
await shot('landing');
await login(page, { id: 'student1', alias: 'Night Owl' });
await page.goto('/map');
const m = page.getByRole('button', { name: /% of rooms free/ });
await expect(m.first()).toBeVisible();
const lowest = (await m.allInnerTexts()).map((t) => parseInt(t, 10)).sort((a, b) => a - b)[0];
await page
  .getByRole('button', { name: new RegExp(`: ${lowest}% of rooms free`) })
  .first()
  .click();
await page.waitForTimeout(2500); // tiles
await shot('map');
await page.getByRole('searchbox').fill('room for 6 with a projector near the library at 3pm');
await page.getByRole('searchbox').press('Enter');
await expect(page.getByLabel('Search filters')).toBeVisible();
await shot('nl-search');
for (let d = 1; d <= 5; d++) {
  await page.goto(`/rooms/LGRT-0101?date=${day(d)}`);
  if (
    await page
      .getByRole('button', { name: /^Class:/ })
      .first()
      .waitFor({ timeout: 4000 })
      .then(
        () => true,
        () => false,
      )
  )
    break;
}
await page
  .getByRole('button', { name: /^Class:/ })
  .first()
  .hover();
await shot('timeline');
await page.goto('/notifications');
await shot('notifications');
await page.goto('/me');
await shot('my-reservations');
await browser.close();
console.log('screenshots written');
