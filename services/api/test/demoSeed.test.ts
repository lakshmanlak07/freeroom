/** P7 demo seed: Demo → Reset re-seeds a rich state, and the seed never breaks BR-1. */
import { describe, expect, it } from 'vitest';
import { LOCAL_DEMO_IDS, seedDemo } from '../src/demoSeed';
import { setupTestApp } from './helpers';

const NOW = new Date('2026-11-16T12:00:00Z'); // Mon 07:00 EST

describe('demo seed', { timeout: 240_000 }, () => {
  it('reset re-seeds: busy mix, claimable (student2), pending near cutoff + incoming claim (student1)', async () => {
    const t = await setupTestApp({ now: NOW });
    const r = await t.req('admin1', 'POST', '/demo/reset');
    expect(r.status).toBe(200);
    const s = r.body.seeded;
    expect(s.claimable && s.pending && s.claimed).toBeTruthy();

    const pcts = (await t.req('student1', 'GET', '/buildings')).body.buildings.map(
      (b: { freePct: number }) => b.freePct,
    );
    expect(pcts.some((p: number) => p >= 60)).toBe(true);
    expect(pcts.some((p: number) => p < 30)).toBe(true);

    const claimable = await t.req('student1', 'GET', `/reservations/${s.claimable}`);
    expect(claimable.body.claimable).toBe(true);
    const incoming = await t.req('student1', 'GET', '/me/claims?direction=incoming');
    expect(incoming.body.claims.map((c: { status: string }) => c.status)).toContain('PENDING');
    const confirm = await t.req('student1', 'POST', `/reservations/${s.pending}/confirm`);
    expect(confirm.status).toBe(200); // window open, cutoff not yet passed
  });

  it('skips rooms with a class right now (BR-1)', async () => {
    const t = await setupTestApp({ now: NOW });
    const inj = await t.req('admin1', 'POST', '/demo/inject-class', {
      roomId: 'LGRT-0101',
      start: '2026-11-16T11:00:00Z',
      end: '2026-11-16T16:00:00Z',
    });
    expect(inj.status).toBe(201);
    await seedDemo(t.db, LOCAL_DEMO_IDS, NOW);
    const sched = await t.req(
      'student1',
      'GET',
      '/rooms/LGRT-0101/schedule?from=2026-11-16T05:00:00Z&to=2026-11-17T05:00:00Z',
    );
    const items = sched.body.items as { kind: string; start: string; end: string }[];
    const cls = items.filter((x) => x.kind === 'class');
    const res = items.filter((x) => x.kind === 'reservation');
    expect(cls.length).toBeGreaterThan(0);
    for (const x of res)
      for (const c of cls) expect(x.start < c.end && c.start < x.end).toBe(false);
  });
});

describe('demo reset status (F3)', () => {
  it('records who reset and when; admin-only', async () => {
    const t = await setupTestApp({ now: NOW });
    expect((await t.req('admin1', 'GET', '/demo/status')).body).toEqual({ lastReset: null });
    expect((await t.req('admin1', 'POST', '/demo/reset')).status).toBe(200);
    expect((await t.req('admin1', 'GET', '/demo/status')).body).toEqual({
      lastReset: { at: NOW.toISOString(), by: 'admin' },
    });
    expect((await t.req('student1', 'GET', '/demo/status')).status).toBe(403);
  });
});
