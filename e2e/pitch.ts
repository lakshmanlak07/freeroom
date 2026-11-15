/**
 * The docs/PITCH.md 3-minute script, automated with two browser contexts (admin1 + student1).
 * Times every beat and fails loudly on a rough edge. RECORD=<file.webm> also records the student
 * window at 1440×900 (raw demo-video footage).
 *   Local:  BASE_URL=http://localhost:5174 pnpm --filter @freeroom/e2e pitch
 *   Live:   BASE_URL=https://<dev> E2E_USERS_FILE=../infra/.demo-users.dev.local.json pnpm --filter @freeroom/e2e pitch
 */
import { chromium, expect, type Page } from '@playwright/test';
import { copyFileSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { login } from './helpers';

const BASE = process.env.BASE_URL ?? 'http://localhost:5174';
const RECORD = process.env.RECORD;
const SIZE = { width: 1440, height: 900 };
const ADMIN = { id: 'admin1', alias: 'FreeRoom Admin' };
const STUDENT = { id: 'student1', alias: 'Night Owl' };
const TZ = 'America/New_York';
const beats: { beat: string; seconds: number; note: string }[] = [];

async function beat(name: string, fn: () => Promise<string | void>) {
  const t0 = Date.now();
  const note = (await fn()) ?? '';
  beats.push({ beat: name, seconds: Math.round((Date.now() - t0) / 100) / 10, note });
}
const campusDay = (plus: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(
    new Date(Date.now() + plus * 86_400_000),
  );
/** Campus wall clock "YYYY-MM-DDTHH:MM" → UTC ISO (DST-aware via Intl). */
function campusIso(local: string) {
  const guess = new Date(`${local}:00Z`);
  const off = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'shortOffset' })
    .formatToParts(guess)
    .find((p) => p.type === 'timeZoneName')!
    .value.replace('GMT', '');
  return new Date(guess.getTime() - Number(off || 0) * 3_600_000).toISOString();
}
/** "9:05 AM – 9:55 AM" inside a class block's aria-label → the 15-min-aligned window covering it. */
function windowFrom(label: string, day: string) {
  const m = label.match(/(\d{1,2}):(\d{2}) (AM|PM) – (\d{1,2}):(\d{2}) (AM|PM)/);
  if (!m) throw new Error(`no time in "${label}"`);
  const h24 = (h: string, ap: string) => (Number(h) % 12) + (ap === 'PM' ? 12 : 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  const s = h24(m[1]!, m[3]!) * 60 + Number(m[2]);
  const e = h24(m[4]!, m[6]!) * 60 + Number(m[5]);
  const at = (mins: number) => `${day}T${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
  return {
    start: campusIso(at(Math.floor(s / 15) * 15)),
    end: campusIso(at(Math.ceil(e / 15) * 15)),
  };
}
const sheetUrl = (path: string, day: string, start: string, end: string) =>
  `${path}?date=${day}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
/** isVisible() doesn't wait; this does (false on timeout). */
const visible = (l: ReturnType<Page['locator']>, timeout: number) =>
  l.waitFor({ state: 'visible', timeout }).then(
    () => true,
    () => false,
  );
const reserveBtn = (p: Page) =>
  p
    .getByRole('dialog', { name: /^Reserve / })
    .getByRole('button', { name: 'Reserve', exact: true });

const browser = await chromium.launch({ headless: true });
const video = RECORD ? mkdtempSync(join(tmpdir(), 'pitch-')) : undefined;
const adminCtx = await browser.newContext({ baseURL: BASE, viewport: SIZE });
const studentCtx = await browser.newContext({
  baseURL: BASE,
  viewport: SIZE,
  ...(video && { recordVideo: { dir: video, size: SIZE } }),
});
for (const ctx of [adminCtx, studentCtx]) {
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('freeroom.tour.v1', 'done'); // the tour is for first-time judges
    } catch {
      /* storage blocked */
    }
  });
}
const admin = await adminCtx.newPage();
const student = await studentCtx.newPage();

// Pre-show (not part of the 3 minutes): reset the demo as admin, as PITCH.md says.
await login(admin, ADMIN);
await admin.goto('/demo');
await admin.getByRole('button', { name: 'Reset demo data' }).click();
await admin.getByRole('button', { name: /Confirm: delete all demo reservations/ }).click();
await expect(admin.getByText(/Last reset:.*by an admin/)).toBeVisible({ timeout: 60_000 });

await beat('1 Hook (landing)', async () => {
  await student.goto('/welcome');
  await expect(student.getByRole('heading', { level: 1 })).toContainText('empty classrooms');
});

await beat('2 Map', async () => {
  await login(student, STUDENT);
  await student.goto('/map');
  const markers = student.getByRole('button', { name: /% of rooms free/ });
  await expect(markers.first()).toBeVisible();
  const pcts = (await markers.allInnerTexts()).map((t) => parseInt(t, 10)).sort((a, b) => a - b);
  await student
    .getByRole('button', { name: new RegExp(`: ${pcts[0]}% of rooms free`) })
    .first()
    .click();
  await expect(student.locator('aside a[href^="/rooms/"]').first()).toBeVisible();
  return `buildings ${pcts.join('/')}% free; opened the busiest`;
});

await beat('3 Natural-language search', async () => {
  await student
    .getByRole('searchbox')
    .fill('room for 5 with a whiteboard near the library until 5');
  await student.getByRole('searchbox').press('Enter');
  const chips = student.getByLabel('Search filters');
  await expect(chips.getByText('Capacity ≥ 5')).toBeVisible();
  const remove = chips.getByRole('button', { name: 'Remove Whiteboard' });
  await expect(remove).toBeVisible();
  const source = await chips.getByText(/Understood by AI|Smart search/).innerText();
  await remove.click();
  return source;
});

// A room with a class in the next few days (the seeded campus has weekday classes).
const roomPath = '/rooms/LGRT-0101';
let day = '';
await beat('4 Timeline (class tooltip)', async () => {
  for (let d = 1; d <= 5 && !day; d++) {
    await student.goto(`${roomPath}?date=${campusDay(d)}`);
    const cls = student.getByRole('button', { name: /^Class:/ }).first();
    if (await visible(cls, 5000)) day = campusDay(d);
  }
  expect(day, 'no class in LGRT 0101 in the next 5 days').not.toBe('');
  await student
    .getByRole('button', { name: /^Class:/ })
    .first()
    .hover();
  await expect(student.getByText(/Class · 25Live|Section|Department/i).first()).toBeVisible();
  return day;
});

await beat('5a Book over a class → named, not submittable', async () => {
  const label = (await student
    .getByRole('button', { name: /^Class:/ })
    .first()
    .getAttribute('aria-label'))!;
  const w = windowFrom(label, day);
  await student.goto(sheetUrl(roomPath, day, w.start, w.end));
  const sheet = student.getByRole('dialog', { name: /^Reserve / });
  await expect(sheet.getByText(/class/i).first()).toBeVisible();
  await expect(reserveBtn(student)).toBeDisabled();
  await student.keyboard.press('Escape');
  return label.split('.')[0]!;
});

await beat('5b Race: two windows, one slot → one wins', async () => {
  const s = campusIso(`${day}T18:00`);
  const e = campusIso(`${day}T18:30`);
  await Promise.all([
    student.goto(sheetUrl(roomPath, day, s, e)),
    admin.goto(sheetUrl(roomPath, day, s, e)),
  ]);
  await Promise.all([reserveBtn(student).click(), reserveBtn(admin).click()]);
  await student.waitForTimeout(3000);
  const won = async (p: Page) => ((await p.getByText(/^Reserved /).count()) > 0 ? 1 : 0);
  const [a, b] = [await won(student), await won(admin)];
  expect(a + b, 'exactly one window should see "Reserved"').toBe(1);
  return a ? 'student won, admin told it’s taken' : 'admin won, student told it’s taken';
});

await beat('5c Claim: owner approves (share contact)', async () => {
  await student.goto('/me');
  const incoming = student.getByRole('region', { name: 'Incoming requests' });
  await incoming.getByRole('button', { name: 'Approve…' }).first().click();
  await incoming.getByRole('button', { name: 'Share my contact' }).first().click();
  await expect(incoming.getByText('Approved').first()).toBeVisible();
  return 'Early Bird (requester) can now reveal Night Owl’s chosen contact';
});

await beat('6 Resilience: inject class → notification + alternatives', async () => {
  const rows = student.getByRole('list', { name: 'upcoming reservations' }).getByRole('listitem');
  const text = await rows.first().innerText();
  const roomId = text
    .match(/\b([A-Z]+) (\d{4})\b/)!
    .slice(1)
    .join('-');
  await admin.goto('/demo');
  await admin.getByRole('combobox', { name: /^Room/ }).selectOption(roomId);
  let picked = false;
  for (const d of [0, 1, 2]) {
    await admin.getByLabel('Day').fill(campusDay(d));
    const owl = admin.locator('label', { hasText: STUDENT.alias }).getByRole('radio').first();
    if (await visible(owl, 3000)) {
      await owl.check();
      picked = true;
      break;
    }
  }
  expect(picked, `no Night Owl reservation in ${roomId}`).toBe(true);
  await admin.getByRole('button', { name: 'Inject class conflict' }).click();
  await student.goto('/notifications');
  await expect(student.getByText('A class now needs your room').first()).toBeVisible({
    timeout: 20_000,
  });
  const alts = await student
    .getByRole('list', { name: 'Alternative rooms' })
    .first()
    .getByRole('listitem')
    .count();
  expect(alts).toBeGreaterThan(0);
  return `${roomId}: ${alts} alternatives`;
});

await adminCtx.close();
await studentCtx.close();
await browser.close();
if (video && RECORD) {
  const f = readdirSync(video).find((x) => x.endsWith('.webm'));
  if (f) copyFileSync(join(video, f), RECORD);
}
console.table(beats);
const total = beats.reduce((s, b) => s + b.seconds, 0);
console.log(`Automated total: ${total.toFixed(1)} s (+ the 20 s architecture slide)`);
