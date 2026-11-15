/**
 * Lighthouse accessibility (target ≥ 95, PRD §0.1 #6) on home, a room page and the map.
 * Signs in with Playwright, then runs Lighthouse user-flow navigations IN THAT SAME TAB (via
 * puppeteer-core over CDP), so the audited pages are the signed-in ones — the summary prints
 * each final URL to prove it. BASE_URL / E2E_USERS as for the smoke suite.
 * Usage: BASE_URL=… [LH_THEME=dark] pnpm --filter @freeroom/e2e lighthouse
 */
import { chromium } from '@playwright/test';
import { startFlow } from 'lighthouse';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { OWNER, login } from './helpers';

const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const TARGET = Number(process.env.LH_MIN_A11Y ?? 95);
const PORT = 9333;

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'lh-')), {
  headless: true,
  baseURL: BASE,
  viewport: { width: 1350, height: 940 },
  args: [`--remote-debugging-port=${PORT}`],
});
// LH_THEME=dark audits the dark palette (contrast is the part that changes).
if (process.env.LH_THEME === 'dark' || process.env.LH_THEME === 'light') {
  await ctx.addInitScript((t) => localStorage.setItem('freeroom.theme', t), process.env.LH_THEME);
}
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto('/welcome');

const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}` });
const tab = (await browser.pages()).find((p) => p.url().startsWith(BASE));
if (!tab) throw new Error('app tab not found');

// LH_FORM=mobile: Lighthouse's default mobile emulation + simulated slow-4G throttling, all categories.
const MOBILE = process.env.LH_FORM === 'mobile';
const results: Record<string, string | number>[] = [];
let room = '';
// /welcome is audited signed out (a signed-in visit redirects to /); the rest signed in.
for (let path of [...(MOBILE ? ['/welcome'] : []), '/', 'ROOM', '/map']) {
  if (path !== '/welcome' && !room) {
    await login(page, OWNER);
    await page.goto('/');
    room = (await page.locator('a[href^="/rooms/"]').first().getAttribute('href'))!;
  }
  if (path === 'ROOM') path = room;
  const flow = await startFlow(tab, {
    flags: {
      onlyCategories: MOBILE
        ? ['performance', 'accessibility', 'best-practices', 'seo']
        : ['accessibility', 'performance'],
      formFactor: MOBILE ? 'mobile' : 'desktop',
      screenEmulation: MOBILE
        ? { mobile: true, width: 412, height: 823, deviceScaleFactor: 1.75, disabled: false }
        : { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1, disabled: false },
      throttlingMethod: MOBILE ? 'simulate' : 'provided',
      disableStorageReset: true, // keep the signed-in session
    },
  });
  await flow.navigate(`${BASE}${path}`);
  const lhr = (await flow.createFlowResult()).steps[0]!.lhr;
  const c = lhr.categories;
  results.push({
    page: path,
    final: new URL(lhr.finalDisplayedUrl).pathname, // proves we were not bounced to /welcome
    accessibility: Math.round((c.accessibility?.score ?? 0) * 100),
    performance: Math.round((c.performance?.score ?? 0) * 100),
    ...(MOBILE && {
      bestPractices: Math.round((c['best-practices']?.score ?? 0) * 100),
      seo: Math.round((c.seo?.score ?? 0) * 100),
      lcp: lhr.audits['largest-contentful-paint']?.displayValue ?? '',
      cls: lhr.audits['cumulative-layout-shift']?.displayValue ?? '',
      tbt: lhr.audits['total-blocking-time']?.displayValue ?? '',
    }),
  });
  for (const ref of c.accessibility?.auditRefs ?? []) {
    const a = lhr.audits[ref.id];
    if (ref.weight > 0 && a && a.score !== null && a.score < 1)
      console.log(`  ${path}: ${a.id} — ${a.title}`);
  }
}
await browser.disconnect();
await ctx.close();
writeFileSync(
  MOBILE ? 'lighthouse-mobile.json' : 'lighthouse-summary.json',
  JSON.stringify(results, null, 2),
);
console.table(results);
const bad = results.filter(
  (r) => Number(r.accessibility) < TARGET || (r.page !== '/welcome' && r.final === '/welcome'),
);
if (bad.length) {
  console.error(`Below ${TARGET} or not signed in: ${bad.map((b) => b.page).join(', ')}`);
  process.exit(1);
}
