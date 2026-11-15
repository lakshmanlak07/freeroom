/**
 * Group invites, end to end (local dev auth): owner reserves → "You're booked" → Invite → copies
 * the link → a signed-out friend opens /i/:token → Join → signs in → is joined → the owner sees
 * the avatar and a notification. Plus the public .ics, a phone run and axe in both themes.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';
import ICAL from 'ical.js';
import { campusDay, campusIso, login } from '../helpers';

test.describe.configure({ mode: 'serial' });

let inviteUrl = '';
let roomId = '';
// Host = admin1: no other suite makes invite links with it (links are rate-limited 10/hour/user).
const OWNER = { id: 'admin1', alias: 'admin1' };
const FRIEND = { id: 'tutor1', alias: 'Tutor Pine' };
const DAY = campusDay(4);
const WINDOW = [campusIso(DAY, '19:00'), campusIso(DAY, '21:30')] as const;

/** A random evening slot on DAY; earlier runs' bookings in that window are cancelled first. */
async function freshOwnerSlot(page: Page) {
  const as = { 'x-dev-user': OWNER.id };
  const mine = (await (await page.request.get('/api/me/reservations', { headers: as })).json()) as {
    reservations?: { id: string; start: string }[];
  };
  for (const r of mine.reservations ?? []) {
    if (r.start >= WINDOW[0] && r.start < WINDOW[1]) {
      await page.request.delete(`/api/reservations/${r.id}`, { headers: as });
    }
  }
  const h = 19 + Math.floor(Math.random() * 2);
  const m = Math.random() < 0.5 ? '00' : '30';
  return {
    start: campusIso(DAY, `${h}:${m}`),
    end: campusIso(DAY, m === '00' ? `${h}:30` : `${h + 1}:00`),
  };
}

test('owner: reserve → "You\'re booked" → Invite → ticket with QR → copy link', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await login(page, OWNER);
  const slot = await freshOwnerSlot(page);
  await page.goto('/');
  await expect(page.locator('a[href^="/rooms/"]').first()).toBeVisible();
  const hrefs = await page
    .locator('a[href^="/rooms/"]')
    .evaluateAll((as) => as.map((a) => a.getAttribute('href')!));
  for (const href of hrefs.sort(() => Math.random() - 0.5).slice(0, 6)) {
    const id = decodeURIComponent(href.split('/').pop()!);
    await page.goto(
      `/rooms/${encodeURIComponent(id)}?date=${DAY}&start=${encodeURIComponent(slot.start)}&end=${encodeURIComponent(slot.end)}`,
    );
    const sheet = page.getByRole('dialog', { name: /^Reserve / });
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: 'Reserve', exact: true }).click();
    const ok = await page
      .getByRole('dialog', { name: /You’re booked/ })
      .waitFor({ timeout: 5000 })
      .then(
        () => true,
        () => false,
      );
    if (ok) {
      roomId = id;
      break;
    }
  }
  expect(roomId, 'no free room for the invite slot').not.toBe('');
  const booked = page.getByRole('dialog', { name: /You’re booked/ });
  await expect(booked.getByRole('button', { name: 'Add to calendar' })).toBeVisible();
  await expect(booked.getByRole('link', { name: 'Get me there' })).toBeVisible();
  await booked.getByRole('button', { name: 'Invite your group' }).click();

  const invite = page.getByRole('dialog', { name: 'Invite your group' });
  await expect(invite.getByRole('img', { name: /QR code/ })).toBeVisible();
  inviteUrl = (await invite.getByTestId('invite-url').innerText()).trim();
  expect(inviteUrl).toMatch(/\/i\/[A-Za-z0-9_-]{22}$/);
  await invite.getByRole('button', { name: 'Copy link' }).click();
  await expect(page.getByText('Copied!')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(inviteUrl);
});

test('friend: opens the link signed out → Join → signs in → is joined', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  const path = new URL(inviteUrl).pathname;
  await page.goto(path);
  await expect(page.getByRole('heading', { name: /booked a study room/ })).toBeVisible();
  await expect(page.getByRole('article', { name: /^Ticket:/ })).toBeVisible();
  await page.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel('Dev user id').fill(FRIEND.id);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(new RegExp(path));
  await expect(page.getByText('You’re in!')).toBeVisible();
  await page.context().close();
});

test('owner: sees the friend on My Reservations and gets a notification', async ({ page }) => {
  await login(page, OWNER);
  await page.goto('/me');
  await expect(page.getByRole('list', { name: /Going: Tutor Pine/ }).first()).toBeVisible();
  await expect
    .poll(
      async () => {
        await page.goto('/notifications');
        return page
          .getByText('Tutor Pine joined your study session')
          .first()
          .waitFor({ timeout: 3_000 })
          .then(
            () => 1,
            () => 0,
          );
      },
      { timeout: 30_000, intervals: [2_000] },
    )
    .toBeGreaterThan(0);
});

test('the public calendar file parses as iCalendar in campus time', async ({ request }) => {
  const token = new URL(inviteUrl).pathname.split('/').pop()!;
  const res = await request.get(`/api/invites/${token}/calendar.ics`);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toBe('text/calendar; charset=utf-8');
  const comp = new ICAL.Component(ICAL.parse(await res.text()));
  const vevent = comp.getFirstSubcomponent('vevent')!;
  expect(vevent.getFirstPropertyValue('summary')).toMatch(/^Study session · /);
  expect(vevent.getFirstProperty('dtstart')!.getParameter('tzid')).toBe('America/New_York');
});

async function phone(browser: Browser, theme: 'light' | 'dark') {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    colorScheme: theme,
  });
  return ctx.newPage();
}

for (const theme of ['light', 'dark'] as const) {
  test(`public page on a phone (${theme}): ticket, no sideways scroll, axe clean`, async ({
    browser,
  }) => {
    const page = await phone(browser, theme);
    await page.goto(new URL(inviteUrl).pathname);
    await expect(page.getByRole('article', { name: /^Ticket:/ })).toBeVisible();
    await expect(page.getByRole('list', { name: /^Going:/ })).toBeVisible();
    const { scroll, inner } = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      inner: window.innerWidth,
    }));
    expect(scroll).toBeLessThanOrEqual(inner);
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([]);
    await page.context().close();
  });
}

test('an invalid link gets a friendly page, not an error', async ({ page }) => {
  await page.goto('/i/AAAAAAAAAAAAAAAAAAAAAA');
  await expect(page.getByRole('heading', { name: 'This link isn’t valid anymore' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Find a free room' })).toBeVisible();
});
