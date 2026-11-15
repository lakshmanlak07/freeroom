/**
 * Test users + login for any target. Deployed stacks (Cognito): logins come from
 * E2E_USERS (JSON of the stack's test-users secret, set by CI) or E2E_USERS_FILE (the
 * gitignored infra/.demo-users.<stage>.local.json). Local dev (x-dev-user): ids only.
 */
import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

type Creds = Record<string, { email: string; password: string }>;
const creds: Creds = process.env.E2E_USERS
  ? JSON.parse(process.env.E2E_USERS)
  : process.env.E2E_USERS_FILE
    ? JSON.parse(readFileSync(process.env.E2E_USERS_FILE, 'utf8'))
    : {};

const ALIAS: Record<string, string> = {
  smoke1: 'Smoke Test A',
  smoke2: 'Smoke Test B',
  faculty1: 'Prof. Maple',
  tutor1: 'Tutor Pine',
};
export interface TestUser {
  id: string;
  alias: string;
}
const user = (id: string): TestUser => ({ id, alias: ALIAS[id] ?? id });
/** Room owner and the claimant. Students in prod (smoke1/2); faculty/tutor locally (quota). */
export const OWNER = user(process.env.SMOKE_OWNER ?? 'smoke1');
export const CLAIMER = user(process.env.SMOKE_CLAIMER ?? 'smoke2');

export async function login(page: Page, u: TestUser) {
  // The demo site's first-visit guided tour would cover the page; tests start past it.
  await page.addInitScript(() => {
    try {
      localStorage.setItem('freeroom.tour.v1', 'done');
    } catch {
      /* storage blocked */
    }
  });
  await page.goto('/login');
  const devId = page.getByLabel('Dev user id');
  const email = page.getByLabel('Email');
  await expect(devId.or(email)).toBeVisible();
  if (await devId.isVisible()) {
    await devId.fill(u.id);
    await page.getByRole('button', { name: 'Continue' }).click();
  } else {
    const c = creds[u.id];
    if (!c) throw new Error(`No login for ${u.id}: set E2E_USERS or E2E_USERS_FILE`);
    await email.fill(c.email);
    await page.getByLabel('Password').fill(c.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  }
  await expect(page.getByRole('navigation').getByRole('link', { name: 'Search' })).toBeVisible();
}

/** YYYY-MM-DD for "today + n" on campus, and that day's HH:MM campus time as a UTC ISO string. */
const TZ = 'America/New_York';
export function campusDay(plusDays: number) {
  const d = new Date(Date.now() + plusDays * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
}
export function campusIso(day: string, hhmm: string) {
  const guess = new Date(`${day}T${hhmm}:00Z`);
  const tzName = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'shortOffset' })
    .formatToParts(guess)
    .find((p) => p.type === 'timeZoneName')!.value; // e.g. GMT-5
  const offsetH = Number(tzName.replace('GMT', '') || 0);
  return new Date(guess.getTime() - offsetH * 3_600_000).toISOString();
}
