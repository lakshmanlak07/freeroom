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

test('reserve a free slot', async () => {
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

test('map loads with building markers', async () => {
  await owner.goto('/map');
  await expect(owner.getByRole('button', { name: /% of rooms free/ }).first()).toBeVisible();
  await expect(owner.locator('.maplibregl-canvas')).toBeVisible();
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
