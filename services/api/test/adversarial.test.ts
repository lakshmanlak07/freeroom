/**
 * P9 release audit: try to break BR-1, BR-5, BR-6, BR-8, and probe every :id route for IDOR.
 * Each test is an attack; passing = the attack failed. Clock pinned to Mon 2026-11-16 07:00 EST.
 */
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { putNotification } from '../src/data/notifications';
import { putPrivate, putUser } from '../src/data/users';
import { setupTestApp } from './helpers';

const NOW = new Date('2026-11-16T12:00:00Z');
let t: Awaited<ReturnType<typeof setupTestApp>>;
let n = 0;
async function user(role: 'STUDENT' | 'FACULTY' = 'STUDENT') {
  const userId = `adv${++n}-${randomUUID().slice(0, 6)}`;
  await putUser(t.db, {
    userId,
    role,
    displayAlias: `Adv ${n}`,
    status: 'ACTIVE',
    shareChannel: 'email',
  });
  await putPrivate(t.db, userId, await t.contacts.encrypt(userId, { email: `${userId}@x.test` }));
  return userId;
}
const inject = (roomId: string, start: string, end: string) =>
  t.req('admin1', 'POST', '/demo/inject-class', { roomId, start, end, name: 'ADV 101' });
const at = async <T>(when: string, fn: () => Promise<T>) => {
  t.clock.now = new Date(when);
  try {
    return await fn();
  } finally {
    t.clock.now = NOW;
  }
};
/** Owner reserves; requester claims. */
async function reservedAndClaimed(room: string, start: string, end: string) {
  const owner = await user();
  const requester = await user();
  const r = await t.reserve(owner, room, start, end);
  expect(r.status).toBe(201);
  const cl = await t.req(requester, 'POST', `/reservations/${r.body.id}/claims`, { partySize: 1 });
  expect(cl.status).toBe(201);
  return { owner, requester, resId: r.body.id as string, claimId: cl.body.claimId as string };
}

beforeAll(async () => {
  t = await setupTestApp({ now: NOW });
});

describe('BR-1: no reservation overlaps a class (half-open intervals)', () => {
  it('blocks any overlap, allows touching edges', async () => {
    const cls = await inject('LGRT-0201', '2026-11-17T15:00:00Z', '2026-11-17T16:00:00Z');
    expect(cls.status).toBe(201);
    const [a, b, c, d] = await Promise.all([user(), user(), user(), user('FACULTY')]);
    const before = await t.reserve(a, 'LGRT-0201', '2026-11-17T14:45:00Z', '2026-11-17T15:00:00Z');
    expect(before.status).toBe(201);
    const after = await t.reserve(b, 'LGRT-0201', '2026-11-17T16:00:00Z', '2026-11-17T16:15:00Z');
    expect(after.status).toBe(201);
    const over = await t.reserve(c, 'LGRT-0201', '2026-11-17T15:45:00Z', '2026-11-17T16:15:00Z');
    expect(over.body.error?.code).toBe('CLASS_CONFLICT');
    const span = await t.reserve(d, 'LGRT-0201', '2026-11-17T14:00:00Z', '2026-11-17T17:00:00Z');
    expect(span.status).toBe(409);
  });

  it('rejects malformed intervals (4xx, never 5xx, never booked)', async () => {
    const u = await user();
    for (const [s, e] of [
      ['2026-11-17T18:00:00Z', '2026-11-17T17:00:00Z'], // end before start
      ['2026-11-17T18:00:00Z', '2026-11-17T18:00:00Z'], // empty
      ['2026-11-17T18:05:00Z', '2026-11-17T18:35:00Z'], // off the 15-min grid
      ['2026-11-16T11:00:00Z', '2026-11-16T11:30:00Z'], // in the past
      ['2026-11-30T15:00:00Z', '2026-11-30T16:00:00Z'], // beyond the 7-day horizon
    ] as const) {
      const r = await t.reserve(u, 'LGRT-0211', s, e);
      expect(r.status, `${s}–${e}`).toBeGreaterThanOrEqual(400);
      expect(r.status, `${s}–${e}`).toBeLessThan(500);
    }
    expect((await t.req(u, 'GET', '/me/reservations')).body.reservations).toEqual([]);
  });
});

describe('BR-8: no double booking under concurrency', () => {
  it('9 different-but-overlapping intervals at once → exactly one wins', async () => {
    const combos = ['15:00', '15:15', '15:30'].flatMap((s) =>
      ['15:45', '16:00', '16:15'].map((e) => [s, e] as const),
    ); // every pair shares 15:30–15:45
    const users = await Promise.all(combos.map(() => user()));
    const res = await Promise.all(
      combos.map(([s, e], i) =>
        t.reserve(users[i]!, 'LGRT-0221', `2026-11-18T${s}:00Z`, `2026-11-18T${e}:00Z`),
      ),
    );
    expect(res.filter((r) => r.status === 201)).toHaveLength(1);
    for (const r of res.filter((x) => x.status !== 201)) {
      expect(r.body.error.code).toBe('SLOT_TAKEN');
    }
  });

  it('the same Idempotency-Key fired 8× concurrently → one reservation', async () => {
    const u = await user();
    const key = randomUUID();
    await Promise.all(
      Array.from({ length: 8 }, () =>
        t.reserve(u, 'LGRT-0301', '2026-11-18T17:00:00Z', '2026-11-18T17:30:00Z', {}, key),
      ),
    );
    const mine = (await t.req(u, 'GET', '/me/reservations')).body.reservations;
    expect(mine.filter((r: { roomId: string }) => r.roomId === 'LGRT-0301')).toHaveLength(1);
  });

  it('reusing an Idempotency-Key with a different body is refused', async () => {
    const u = await user();
    const key = randomUUID();
    const first = await t.reserve(
      u,
      'LGRT-0311',
      '2026-11-18T18:00:00Z',
      '2026-11-18T18:30:00Z',
      {},
      key,
    );
    expect(first.status).toBe(201);
    const again = await t.reserve(
      u,
      'LGRT-0311',
      '2026-11-18T19:00:00Z',
      '2026-11-18T19:30:00Z',
      {},
      key,
    );
    expect(again.status).toBe(400);
  });
});

describe('BR-6: nothing confirms/approves/claims at or after start − 4h (server clock)', () => {
  it('allowed 1 ms before the cutoff; refused exactly at it', async () => {
    // Start Tue 16:00Z → cutoff Tue 12:00Z (confirm window opened Mon 16:00Z).
    const a = await reservedAndClaimed('CS-0101', '2026-11-17T16:00:00Z', '2026-11-17T17:00:00Z');
    const b = await reservedAndClaimed('CS-0111', '2026-11-17T16:00:00Z', '2026-11-17T17:00:00Z');
    const late = await user();
    const ok = await at('2026-11-17T11:59:59.999Z', () =>
      t.req(a.owner, 'POST', `/reservations/${a.resId}/confirm`),
    );
    expect(ok.status).toBe(200);
    await at('2026-11-17T12:00:00.000Z', async () => {
      const confirm = await t.req(b.owner, 'POST', `/reservations/${b.resId}/confirm`);
      expect(confirm.status).toBe(409);
      expect(confirm.body.error.code).toBe('CUTOFF_PASSED');
      const approve = await t.req(a.owner, 'POST', `/claims/${a.claimId}/approve`, {
        mode: 'SHARE_CONTACT',
      });
      expect(approve.status).toBe(409);
      const claim = await t.req(late, 'POST', `/reservations/${a.resId}/claims`, { partySize: 1 });
      expect(claim.status).toBe(409);
    });
  });
});

describe('BR-5: contact only via reveal after an approved share-contact claim', () => {
  it('refused while pending, after deny, after TRANSFER, to strangers, the owner and admins', async () => {
    const a = await reservedAndClaimed('ILC-0101', '2026-11-19T15:00:00Z', '2026-11-19T16:00:00Z');
    const stranger = await user();
    const contact = (u: string) => t.req(u, 'GET', `/claims/${a.claimId}/contact`);
    expect((await contact(a.requester)).status).toBe(403); // pending
    for (const u of [stranger, a.owner, 'admin1']) expect((await contact(u)).status).toBe(403);
    // An admin can't approve on the owner's behalf (that would leak the owner's contact).
    const adminApprove = await t.req('admin1', 'POST', `/claims/${a.claimId}/approve`, {
      mode: 'SHARE_CONTACT',
    });
    expect(adminApprove.status).toBe(403);
    expect((await t.req(a.owner, 'POST', `/claims/${a.claimId}/deny`)).status).toBe(200);
    expect((await contact(a.requester)).status).toBe(403); // denied

    const b = await reservedAndClaimed('ILC-0111', '2026-11-19T15:00:00Z', '2026-11-19T16:00:00Z');
    const transfer = await t.req(b.owner, 'POST', `/claims/${b.claimId}/approve`, {
      mode: 'TRANSFER',
    });
    expect(transfer.status).toBe(200);
    expect((await t.req(b.requester, 'GET', `/claims/${b.claimId}/contact`)).status).toBe(403);
  });

  it('the approved requester gets exactly the shared channel, only until end + 24h', async () => {
    const a = await reservedAndClaimed('ILC-0121', '2026-11-19T15:00:00Z', '2026-11-19T16:00:00Z');
    await t.req(a.owner, 'POST', `/claims/${a.claimId}/approve`, { mode: 'SHARE_CONTACT' });
    const ok = await t.req(
      a.requester,
      'GET',
      `/claims/${a.claimId}/contact`,
      undefined,
      {},
      { allowPII: true },
    );
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({
      channel: 'email',
      value: `${a.owner}@x.test`,
      expiresAt: expect.any(String),
    });
    const expired = await at('2026-11-20T16:00:00Z', () =>
      t.req(a.requester, 'GET', `/claims/${a.claimId}/contact`),
    );
    expect(expired.status).toBe(403);
  });
});

describe('IDOR: every :id route refuses the wrong user', () => {
  it('reservation, claim, admin and demo routes', async () => {
    const a = await reservedAndClaimed('CS-0201', '2026-11-20T15:00:00Z', '2026-11-20T16:00:00Z');
    const x = await user(); // attacker: signed in, unrelated
    const call = (m: string, p: string, b?: unknown) => t.req(x, m, p, b);

    const pub = await call('GET', `/reservations/${a.resId}`);
    expect(pub.status).toBe(200); // public projection only
    expect(pub.body.isMine).toBe(false);
    expect(pub.body).not.toHaveProperty('ownerId');

    expect((await call('POST', `/reservations/${a.resId}/confirm`)).status).toBe(403);
    expect((await call('DELETE', `/reservations/${a.resId}`)).status).toBe(403);
    expect((await call('GET', `/reservations/${a.resId}/events`)).status).toBe(403);
    expect((await call('POST', `/claims/${a.claimId}/approve`, { mode: 'TRANSFER' })).status).toBe(
      403,
    );
    expect((await call('POST', `/claims/${a.claimId}/deny`)).status).toBe(403);
    expect((await call('POST', `/claims/${a.claimId}/withdraw`)).status).toBe(403);
    expect((await call('GET', `/claims/${a.claimId}/contact`)).status).toBe(403);
    // The requester can't approve their own claim; the owner can't withdraw someone else's.
    const selfApprove = await t.req(a.requester, 'POST', `/claims/${a.claimId}/approve`, {
      mode: 'TRANSFER',
    });
    expect(selfApprove.status).toBe(403);
    expect((await t.req(a.owner, 'POST', `/claims/${a.claimId}/withdraw`)).status).toBe(403);
    // The owner can't claim their own reservation.
    const ownClaim = await t.req(a.owner, 'POST', `/reservations/${a.resId}/claims`, {
      partySize: 1,
    });
    expect(ownClaim.status).toBeGreaterThanOrEqual(400);
    expect(ownClaim.status).toBeLessThan(500);
    // Self-promotion and demo controls.
    expect((await call('POST', `/admin/users/${x}/role`, { role: 'FACULTY' })).status).toBe(403);
    for (const p of [
      '/demo/reset',
      '/demo/inject-class',
      '/demo/fast-forward',
      '/demo/inject-conflict',
    ]) {
      expect((await call('POST', p, { reservationId: a.resId })).status, p).toBe(403);
    }
  });

  it('forged / unknown ids are 404 (never 500), including tampered claim ids', async () => {
    const a = await reservedAndClaimed('CS-0211', '2026-11-20T15:00:00Z', '2026-11-20T16:00:00Z');
    const x = await user();
    for (const [m, p] of [
      ['GET', `/reservations/${randomUUID()}`],
      ['POST', `/reservations/${randomUUID()}/confirm`],
      ['DELETE', `/reservations/${randomUUID()}`],
      ['GET', `/reservations/${randomUUID()}/events`],
      ['POST', `/reservations/${randomUUID()}/claims`],
      ['GET', `/claims/${a.resId}_${randomUUID()}/contact`],
      ['POST', `/claims/${a.resId}_${randomUUID()}/deny`],
      ['POST', `/claims/not-a-claim/withdraw`],
    ] as const) {
      const r = await t.req(x, m, p, m === 'POST' ? { partySize: 1 } : undefined);
      expect(r.status, `${m} ${p}`).toBe(404);
    }
  });

  it("can't mark someone else's notifications read", async () => {
    const owner = await user();
    await putNotification(t.db, {
      userId: owner,
      notifId: `adv-${randomUUID()}`,
      type: 'claim.received',
      reservationId: null,
      title: 'Someone requested your room',
      body: 'b',
      createdAt: NOW.toISOString(),
    } as never);
    const theirs = (await t.req(owner, 'GET', '/me/notifications')).body.notifications;
    expect(theirs.length).toBeGreaterThan(0);
    const x = await user();
    const r = await t.req(x, 'POST', '/me/notifications/read', {
      ids: theirs.map((m: { id: string }) => m.id),
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.updated).toBe(0);
    const after = (await t.req(owner, 'GET', '/me/notifications')).body.notifications;
    expect(after.every((m: { read: boolean }) => !m.read)).toBe(true);
  });
});
