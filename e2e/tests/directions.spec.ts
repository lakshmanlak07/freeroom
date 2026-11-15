/**
 * "Get me there": room → directions (geolocation mocked) → ETA + arrival verdict → "Reserve it for
 * when I arrive" pre-fills the reserve sheet. The route response is mocked for a deterministic
 * verdict (the server's verdict logic is unit/API-tested); the map + panel are real.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { campusDay, campusIso, login } from '../helpers';

const ROOM = 'LGRT-0101';
const DAY = campusDay(2);
const ARRIVE = campusIso(DAY, '14:07');
const ROUTE = {
  distanceMeters: 480,
  durationSeconds: 420,
  arriveAt: ARRIVE,
  geometry: {
    type: 'LineString',
    coordinates: [
      [-72.5283, 42.3896],
      [-72.52685, 42.3896],
      [-72.52685, 42.39385],
    ],
  },
  steps: [
    {
      instruction: 'Head east on the campus path',
      distanceMeters: 120,
      durationSeconds: 95,
      type: 'Depart',
    },
    {
      instruction: 'Turn left toward Lederle',
      distanceMeters: 360,
      durationSeconds: 325,
      type: 'Turn',
      direction: 'left',
    },
    { instruction: 'Arrive at LGRT lobby', distanceMeters: 0, durationSeconds: 0, type: 'Arrive' },
  ],
  origin: { lat: 42.3896, lng: -72.5283 },
  destinationEntrance: {
    lat: 42.39385,
    lng: -72.52685,
    kind: 'main',
    label: 'LGRT lobby (west doors)',
  },
  accessibleRouting: false,
  arrival: { kind: 'FREE_FOR', minutes: 83, until: campusIso(DAY, '15:30') },
};

test.use({
  geolocation: { latitude: 42.3896, longitude: -72.5283 },
  permissions: ['geolocation'],
});

async function openDirections(page: Page) {
  await page.route(`**/api/rooms/${ROOM}/route*`, (r) =>
    r.fulfill({ json: ROUTE, headers: { 'cache-control': 'no-store' } }),
  );
  await login(page, { id: 'faculty1', alias: 'Prof. Maple' });
  await page.goto(`/rooms/${ROOM}`);
  await page.getByRole('link', { name: 'Get me there' }).first().click();
  await expect(page).toHaveURL(new RegExp(`/map\\?to=${ROOM}`));
}

test('desktop: ETA + verdict, then "Reserve it for when I arrive" pre-fills the sheet', async ({
  page,
}) => {
  await openDirections(page);
  await expect(page.getByText('min walk').first()).toBeVisible();
  await expect(page.getByTestId('arrival-verdict')).toHaveText(/Free for 1h 23m after you arrive/);
  await expect(page.getByRole('heading', { name: 'LGRT 0101' })).toBeVisible();
  await expect(page.getByText('Head east on the campus path')).toBeVisible();
  await page.getByRole('button', { name: 'Reserve it for when I arrive' }).click();
  const sheet = page.getByRole('dialog', { name: /^Reserve / });
  await expect(sheet).toBeVisible();
  const start = Date.parse(campusIso(DAY, '14:15')); // 14:07 rounded up to the next slot
  await expect(sheet.locator('select').first()).toHaveValue(String(start));
});

test('location blocked → "I\'m at…" fallback is one tap away', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', {
      value: {
        getCurrentPosition: (_ok: unknown, err: (e: unknown) => void) => err({ code: 1 }),
      },
    });
  });
  await page.route(`**/api/rooms/${ROOM}/route*`, (r) => r.fulfill({ json: ROUTE }));
  await login(page, { id: 'faculty1', alias: 'Prof. Maple' });
  await page.goto(`/map?to=${ROOM}`);
  await expect(page.getByText('Location is off — no problem.')).toBeVisible();
  await page
    .getByRole('button', { name: /^I’m at / })
    .first()
    .click();
  await expect(page.getByTestId('arrival-verdict')).toBeVisible();
  await ctx.close();
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('directions live in a draggable bottom sheet', async ({ page }) => {
    await openDirections(page);
    const sheet = page.getByRole('complementary', { name: 'Directions' });
    await expect(sheet).toBeVisible();
    await expect(page.getByTestId('arrival-verdict')).toBeVisible();
    // Opens at peek (map stays visible); the handle expands it for the steps.
    await page.getByRole('button', { name: /Expand Directions/ }).tap();
    await expect(page.getByRole('button', { name: /Collapse Directions/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await expect(page.getByText('Head east on the campus path')).toBeInViewport();
    const { scroll, inner } = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      inner: window.innerWidth,
    }));
    expect(scroll).toBeLessThanOrEqual(inner);
  });
});

for (const theme of ['light', 'dark'] as const) {
  test(`axe: directions panel (${theme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await openDirections(page);
    await expect(page.getByTestId('arrival-verdict')).toBeVisible();
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .exclude('.maplibregl-canvas')
      .analyze();
    const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([]);
  });
}
