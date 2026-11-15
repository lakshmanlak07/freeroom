/** Regression tests for the 2026-11-15 audit fixes that are visible in the browser. */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { campusDay, campusIso, login } from '../helpers';

test('hand-edited URL params never crash a page (audit L3)', async ({ page }) => {
  await login(page, { id: 'faculty1', alias: 'Prof. Maple' });
  await page.goto('/?date=foo&from=99:99&to=noon');
  await expect(page.getByRole('heading', { name: 'Find a free room' })).toBeVisible();
  const room = await page.locator('a[href^="/rooms/"]').first().getAttribute('href');
  await page.goto(`${room}?date=2026-13-45`);
  await expect(page.getByRole('group', { name: 'Day timeline' })).toBeVisible();
  await expect(page.getByText(/something went wrong/i)).toHaveCount(0);
});

test('the next user never sees the previous user’s cached data (audit M4)', async ({
  page,
  request,
}) => {
  const cfg = await (await request.get('/config.json')).json().catch(() => ({}));
  test.skip(!!cfg.userPoolId, 'dev-auth only (creates data through the local API)');
  // Leftovers from an interrupted run would hit faculty1's active quota.
  const as = { 'x-dev-user': 'faculty1' };
  const mineNow = (await (await request.get('/api/me/reservations', { headers: as })).json()) as {
    reservations?: { id: string; roomId: string }[];
  };
  for (const r of mineNow.reservations ?? []) {
    if (r.roomId === 'CS-0111') await request.delete(`/api/reservations/${r.id}`, { headers: as });
  }
  // Random slot so repeated runs don't collide (the DB is shared across runs).
  const day = campusDay(3 + Math.floor(Math.random() * 4));
  const h = 19 + Math.floor(Math.random() * 4);
  const m = Math.random() < 0.5 ? '00' : '30';
  const created = await request.post('/api/reservations', {
    headers: { 'x-dev-user': 'faculty1', 'idempotency-key': randomUUID() },
    data: {
      roomId: 'CS-0111',
      start: campusIso(day, `${h}:${m}`),
      end: campusIso(day, m === '00' ? `${h}:15` : `${h}:45`),
      partySize: 1,
    },
  });
  expect(created.status()).toBe(201);

  const id = ((await created.json()) as { id: string }).id;
  try {
    await login(page, { id: 'faculty1', alias: 'Prof. Maple' });
    await page.goto('/me');
    const mine = page.getByRole('list', { name: 'Upcoming reservations' });
    await expect(mine.getByText('CS 0111').first()).toBeVisible();

    // Switch users WITHOUT a page reload (a reload would hide a stale in-memory cache).
    await page.getByRole('button', { name: 'Sign out' }).first().click();
    const devId = page.getByLabel('Dev user id');
    // Signing out from a protected page lands on /login; from elsewhere, follow "Sign in".
    const onLogin = await devId
      .waitFor({ timeout: 3_000 })
      .then(() => true)
      .catch(() => false);
    if (!onLogin) await page.getByRole('link', { name: 'Sign in' }).first().click();
    await page.route('**/api/me/reservations*', async (r) => {
      await new Promise((res) => setTimeout(res, 3_000)); // hold the new user's data back
      await r.continue();
    });
    await devId.fill('tutor1');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: /Reservations/ })
      .first()
      .click();
    await page.waitForTimeout(1_000);
    await expect(page.getByText('CS 0111')).toHaveCount(0);
  } finally {
    await request.delete(`/api/reservations/${id}`, { headers: { 'x-dev-user': 'faculty1' } });
  }
});
