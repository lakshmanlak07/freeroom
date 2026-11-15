/**
 * Re-capture docs/screenshots from the current UI (local stack, dev sign-in):
 * landing, map, timeline, reserve sheet, my reservations, notifications, NL search —
 * light + dark × desktop (1440×900) + mobile (390×844). The fox is visible in timeline-light-desktop.
 * Desktop-light shots keep their old names (landing.png, map.png, …) for the README.
 * Usage: (pnpm dev:api; pnpm dev:web) then `npx tsx screenshots.ts` [BASE_URL=…]
 */
import { chromium, expect, type Page } from '@playwright/test';
import { login } from './helpers';

const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const OUT = '../docs/screenshots';
const day = (plus: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(
    new Date(Date.now() + plus * 86_400_000),
  );

const browser = await chromium.launch();
for (const theme of ['light', 'dark'] as const) {
  for (const device of ['desktop', 'mobile'] as const) {
    const mobile = device === 'mobile';
    const ctx = await browser.newContext({
      baseURL: BASE,
      viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
      deviceScaleFactor: mobile ? 2 : 1,
      colorScheme: theme,
      hasTouch: mobile,
      isMobile: mobile,
    });
    const page = await ctx.newPage();
    const name = (base: string) =>
      theme === 'light' && !mobile ? base : `${base}-${theme}-${device}`;
    const shot = async (base: string) => {
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${OUT}/${name(base)}.png` });
    };
    await capture(page, shot, { mobile, fox: theme === 'light' && !mobile });
    await ctx.close();
  }
}
await browser.close();
console.log('screenshots written');

async function capture(
  page: Page,
  shot: (base: string) => Promise<void>,
  o: { mobile: boolean; fox: boolean },
) {
  await page.goto('/welcome');
  await page.getByText(/rooms free right now/).waitFor();
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

  await page.goto('/');
  await page.getByRole('searchbox').fill('room for 6 with a projector near the library at 3pm');
  await page.getByRole('searchbox').press('Enter');
  await expect(page.getByLabel('Search filters')).toBeVisible();
  await shot('nl-search');

  for (let d = 1; d <= 5; d++) {
    await page.goto(`/rooms/LGRT-0101?date=${day(d)}`);
    const hasClass = await page
      .getByRole('button', { name: /^Class:/ })
      .first()
      .waitFor({ timeout: 4000 })
      .then(
        () => true,
        () => false,
      );
    if (hasClass) break;
  }
  const cls = page.getByRole('button', { name: /^Class:/ }).first();
  if (o.mobile) await cls.tap();
  else await cls.hover();
  if (o.fox) {
    // Bring the fox into frame next to the class popover.
    const b = (await cls.boundingBox())!;
    await page.mouse.move(b.x + b.width + 160, b.y + 60, { steps: 12 });
    await page.waitForTimeout(2600);
  }
  await shot('timeline');

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Reserve( a time)?$/ }).click();
  await expect(page.getByRole('dialog', { name: /^Reserve / })).toBeVisible();
  await shot('reserve-sheet');
  await page.keyboard.press('Escape');

  await page.goto('/notifications');
  await shot('notifications');
  await page.goto('/me');
  await shot('my-reservations');
}
