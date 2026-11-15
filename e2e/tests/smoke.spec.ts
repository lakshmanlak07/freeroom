/**
 * Golden-path smoke (PRD §0.1 #6): login, search, reserve, claim → approve → reveal, map.
 * Reserves 8:00–8:30 PM three campus days out in a random room, and cancels it at the end.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';
import { CLAIMER, OWNER, campusDay, campusIso, login } from '../helpers';

test.describe.configure({ mode: 'serial' });

const day = campusDay(3); // inside the 7-day horizon, outside the 24h confirm window
const start = campusIso(day, '20:00');
const end = campusIso(day, '20:30');
let roomId = '';
let owner: Page;

async function asUser(browser: Browser, u: typeof OWNER) {
  const page = await (await browser.newContext()).newPage();
  await login(page, u);
  return page;
}

test.beforeAll(async ({ browser }) => {
  owner = await asUser(browser, OWNER);
});

test('landing page is public', async ({ page }) => {
  await page.goto('/welcome');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('empty classrooms');
});

test('search lists rooms', async () => {
  await owner.goto('/');
  const cards = owner.locator('a[href^="/rooms/"]');
  await expect(cards.first()).toBeVisible();
  expect(await cards.count()).toBeGreaterThan(3);
});

test('natural-language search → editable filter chips', async () => {
  await owner.goto('/');
  await owner.getByRole('searchbox').fill('room for 6 with a projector near the library');
  await owner.getByRole('searchbox').press('Enter');
  const chips = owner.getByLabel('Search filters');
  const label = chips.getByText(/Understood by AI|Smart search/);
  await expect(label).toBeVisible();
  await expect(chips.getByText('Capacity ≥ 6')).toBeVisible();
  await expect(chips.getByRole('button', { name: 'Remove Projector' })).toBeVisible();
  console.log(`NL search source: ${await label.innerText()}`);
  await owner.goto('/'); // back to the plain list for the next test
});

test('reserve a free slot', async () => {
  await expect(owner.locator('a[href^="/rooms/"]').first()).toBeVisible();
  const hrefs = await owner
    .locator('a[href^="/rooms/"]')
    .evaluateAll((as) => as.map((a) => a.getAttribute('href')!));
  // Random order so repeated/parallel runs don't fight over one room.
  for (const href of hrefs.sort(() => Math.random() - 0.5).slice(0, 6)) {
    const id = decodeURIComponent(href.split('/').pop()!);
    await owner.goto(
      `/rooms/${encodeURIComponent(id)}?date=${day}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
    );
    const sheet = owner.getByRole('dialog', { name: /^Reserve / });
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: 'Reserve', exact: true }).click();
    const done = owner.getByText(/^Reserved /);
    const failed = sheet.getByRole('alert');
    await expect(done.or(failed).first()).toBeVisible();
    if (await done.isVisible()) {
      roomId = id;
      break;
    }
  }
  expect(roomId, 'no free room found for the smoke slot').not.toBe('');
});

test('claim → approve (share contact) → reveal', async ({ browser }) => {
  const claimer = await asUser(browser, CLAIMER);
  await claimer.goto(`/rooms/${encodeURIComponent(roomId)}?date=${day}`);
  await claimer
    .getByRole('button', { name: new RegExp(`Reservation held by ${OWNER.alias}.*Claimable`) })
    .first()
    .click();
  const dialog = claimer.getByRole('dialog', { name: 'Request this room' });
  await dialog.getByRole('button', { name: 'Send request' }).click();
  await expect(dialog).toBeHidden();

  await owner.goto('/me');
  const incoming = owner.getByRole('region', { name: 'Incoming requests' });
  await incoming.getByRole('button', { name: 'Approve…' }).first().click();
  await incoming.getByRole('button', { name: 'Share my contact' }).first().click();
  await expect(incoming.getByText('Approved').first()).toBeVisible();

  await claimer.goto('/me');
  await claimer.getByRole('button', { name: 'Show contact' }).first().click();
  await expect(claimer.getByRole('link', { name: /@|\+?\d/ }).first()).toBeVisible();
  await claimer.context().close();
});

test('map renders: style 200, tiles 200, canvas painted, building markers', async () => {
  const usesLocation = await owner
    .evaluate(async () => {
      const r = await fetch('/config.json', { cache: 'no-store' });
      const c = (await r.json().catch(() => ({}))) as { mapApiKey?: string };
      return !!c.mapApiKey;
    })
    .catch(() => false);
  const errors: string[] = [];
  owner.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await owner.addInitScript(() =>
    document.addEventListener('securitypolicyviolation', (e) =>
      console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`),
    ),
  );
  const style = usesLocation
    ? owner.waitForResponse((r) => r.url().includes('/v2/styles/Standard/descriptor'))
    : null;
  const tile = owner.waitForResponse(
    (r) =>
      /maps\.geo\.[a-z0-9-]+\.amazonaws\.com\/v2\/tiles\/|tile\.openstreetmap\.org/.test(r.url()) &&
      r.status() === 200,
  );
  await owner.goto('/map');
  if (style) expect((await style).status()).toBe(200);
  await tile;
  await expect(owner.getByRole('button', { name: /% of rooms free/ }).first()).toBeVisible();
  const canvas = owner.locator('canvas.maplibregl-canvas');
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  expect(box.width).toBeGreaterThan(200);
  expect(box.height).toBeGreaterThan(200);
  await owner.waitForTimeout(1500); // let tiles paint
  // A blank WebGL canvas compresses to a few KB; a painted basemap is far larger.
  expect((await canvas.screenshot()).length, 'map canvas looks blank').toBeGreaterThan(15_000);
  expect(errors.filter((e) => /CSP violation|maplibre|\[map\]/i.test(e))).toEqual([]);
  await expect(owner.getByText('The map didn’t load')).toHaveCount(0);
});

test.afterAll(async () => {
  if (!roomId) return;
  await owner.goto('/me');
  const row = owner
    .getByRole('list', { name: 'Upcoming reservations' })
    .getByRole('listitem')
    .filter({ hasText: roomId.replace('-', ' ') })
    .first();
  await row.getByRole('button', { name: 'Cancel' }).click();
  await row.getByRole('button', { name: 'Yes, cancel' }).click();
  await expect(row.getByText('Cancelled')).toBeVisible();
});
