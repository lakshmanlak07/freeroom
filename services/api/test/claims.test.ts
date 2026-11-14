/**
 * Claims, contact reveal, sweeper, notifications, demo controls — against DynamoDB Local.
 * Clock pinned to Mon 2026-11-16 07:00 EST.
 */
import { QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { beforeAll, describe, expect, it } from 'vitest';
import { getLocks } from '../src/data/schedule';
import { keys } from '../src/data/keys';
import { onChange, type ChangeRecord } from '../src/notify/onChange';
import { createStreamPoller } from '../src/notify/streamPoller';
import { sweep } from '../src/sweeper';
import { ENDPOINT, setupTestApp, silent } from './helpers';

const NOW = new Date('2026-11-16T12:00:00Z');
type T = Awaited<ReturnType<typeof setupTestApp>>;
let t: T;
beforeAll(async () => {
  t = await setupTestApp({ now: NOW });
});

const claim = (user: string, resId: string, partySize = 2) =>
  t.req(user, 'POST', `/reservations/${resId}/claims`, { partySize, message: 'Can we swap?' });
const decide = (user: string, claimId: string, action: string, body?: unknown) =>
  t.req(user, 'POST', `/claims/${claimId}/${action}`, body);
const contact = (user: string, claimId: string) =>
  t.req(user, 'GET', `/claims/${claimId}/contact`, undefined, {}, { allowPII: true });
const at = (iso: string) => (t.clock.now = new Date(iso));

// R1: student1 owns LGRT-0101 Tue 20:00–21:00Z → cutoff Tue 16:00Z.
let r1: string;
let c1: string;

describe('submitting claims', () => {
  it('creates a PENDING claim that expires at cutoff', async () => {
    r1 = (await t.reserve('student1', 'LGRT-0101', '2026-11-17T20:00:00Z', '2026-11-17T21:00:00Z'))
      .body.id;
    const c = await claim('student2', r1);
    expect(c.status).toBe(201);
    expect(c.body).toMatchObject({
      status: 'PENDING',
      expiresAt: '2026-11-17T16:00:00.000Z',
      requesterAlias: 'Early Bird',
      ownerAlias: 'Night Owl',
    });
    c1 = c.body.claimId;
  });

  it('1 open claim per reservation; never on your own', async () => {
    expect((await claim('student2', r1)).body.error.code).toBe('CLAIM_EXISTS');
    expect((await claim('student1', r1)).body.error.code).toBe('OWN_RESERVATION');
  });

  it('max 3 open claims per user', async () => {
    const ids = [];
    for (const room of ['CS-0101', 'CS-0111', 'CS-0121', 'CS-0201']) {
      ids.push(
        (await t.reserve('faculty1', room, '2026-11-18T15:00:00Z', '2026-11-18T16:00:00Z')).body.id,
      );
    }
    for (const id of ids.slice(0, 3)) expect((await claim('tutor1', id)).status).toBe(201);
    const fourth = await claim('tutor1', ids[3]);
    expect([fourth.status, fourth.body.error.code]).toEqual([429, 'QUOTA_EXCEEDED']);
  });

  it('reservation detail is public-only for strangers, full for claimants', async () => {
    const stranger = await t.req('faculty1', 'GET', `/reservations/${r1}`);
    expect(stranger.body).toMatchObject({ kind: 'reservation', ownerAlias: 'Night Owl' });
    expect(stranger.body).not.toHaveProperty('partySize');
    expect((await t.req('student2', 'GET', `/reservations/${r1}`)).body).toHaveProperty(
      'partySize',
    );
  });
});

describe('BR-6: no acceptance at or after cutoff', () => {
  it('approve at exactly cutoff → CUTOFF_PASSED; claim after cutoff rejected', async () => {
    try {
      at('2026-11-17T16:00:00.000Z');
      const late = await decide('student1', c1, 'approve', { mode: 'SHARE_CONTACT' });
      expect([late.status, late.body.error.code]).toEqual([409, 'CUTOFF_PASSED']);
      const lateClaim = await claim('tutor1', r1);
      expect([lateClaim.status, lateClaim.body.error.code]).toEqual([409, 'CUTOFF_PASSED']);
    } finally {
      t.clock.now = NOW;
    }
  });

  it('approve at cutoff − 1ms works; only the owner may decide', async () => {
    try {
      at('2026-11-17T15:59:59.999Z');
      expect((await decide('faculty1', c1, 'approve', { mode: 'SHARE_CONTACT' })).status).toBe(403);
      const ok = await decide('student1', c1, 'approve', { mode: 'SHARE_CONTACT' });
      expect(ok.body).toMatchObject({ status: 'APPROVED', mode: 'SHARE_CONTACT' });
      expect((await decide('student1', c1, 'deny')).status).toBe(409);
    } finally {
      t.clock.now = NOW;
    }
  });
});

describe('BR-5 contact reveal', () => {
  it('only the approved requester sees the shared channel, until end + 24h, and it is audited', async () => {
    const ok = await contact('student2', c1);
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({
      channel: 'email',
      value: 'student1@demo.freeroom.test',
      expiresAt: '2026-11-18T21:00:00.000Z',
    });
    expect((await contact('faculty1', c1)).status).toBe(403);
    expect((await contact('student1', c1)).status).toBe(403);
    try {
      at('2026-11-18T21:00:00.000Z');
      expect((await contact('student2', c1)).status).toBe(403);
    } finally {
      t.clock.now = NOW;
    }
    const audits = await t.db.doc.send(
      new QueryCommand({
        TableName: t.db.table,
        KeyConditionExpression: 'PK = :p AND begins_with(SK, :a)',
        ExpressionAttributeValues: { ':p': keys.resPk(r1), ':a': 'AUDIT#' },
      }),
    );
    expect(audits.Items).toHaveLength(1);
    expect(audits.Items![0]).toMatchObject({ type: 'CONTACT_REVEALED', actorId: 'student2' });
  });

  it('a pending or denied claim never reveals contact', async () => {
    const r = (
      await t.reserve('student1', 'ILC-0101', '2026-11-17T20:00:00Z', '2026-11-17T21:00:00Z')
    ).body.id;
    const c = (await claim('student2', r)).body.claimId;
    expect((await contact('student2', c)).status).toBe(403);
    await decide('student1', c, 'deny');
    expect((await contact('student2', c)).status).toBe(403);
  });

  it('contact is ciphertext at rest (full table scan)', async () => {
    const dump = JSON.stringify(
      (await t.db.doc.send(new ScanCommand({ TableName: t.db.table }))).Items,
    );
    expect(dump).not.toContain('@demo.freeroom.test');
    expect(dump).not.toContain('555 0100');
  });
});

describe('TRANSFER', () => {
  it('moves ownership, writes TRANSFERRED, denies other pending claims, moves quota', async () => {
    const res = (
      await t.reserve('faculty1', 'HAS-0101', '2026-11-18T15:00:00Z', '2026-11-18T16:00:00Z')
    ).body.id;
    const mine = (await claim('student2', res)).body.claimId;
    const other = (await claim('admin1', res)).body.claimId;

    const ok = await decide('faculty1', mine, 'approve', { mode: 'TRANSFER' });
    expect(ok.body).toMatchObject({ status: 'APPROVED', mode: 'TRANSFER' });

    const view = await t.req('student2', 'GET', `/reservations/${res}`);
    expect(view.body).toMatchObject({
      isMine: true,
      ownerAlias: 'Early Bird',
      status: 'CONFIRMED',
    });
    const events = (await t.req('student2', 'GET', `/reservations/${res}/events`)).body.events;
    expect(events.map((e: { type: string }) => e.type)).toEqual(
      expect.arrayContaining(['CLAIM_APPROVED', 'TRANSFERRED', 'CLAIM_DENIED']),
    );
    const outgoing = (await t.req('admin1', 'GET', '/me/claims?direction=outgoing')).body.claims;
    expect(outgoing.find((c: { claimId: string }) => c.claimId === other).status).toBe('DENIED');
    const oldOwner = (await t.req('faculty1', 'GET', '/me/reservations')).body.reservations;
    expect(oldOwner.map((r: { id: string }) => r.id)).not.toContain(res);
    const newOwner = (await t.req('student2', 'GET', '/me/reservations')).body.reservations;
    expect(newOwner.map((r: { id: string }) => r.id)).toContain(res);
    expect((await t.req('faculty1', 'DELETE', `/reservations/${res}`)).status).toBe(403);
  });

  it('withdraw is requester-only', async () => {
    const res = (
      await t.reserve('faculty1', 'HAS-0111', '2026-11-18T17:00:00Z', '2026-11-18T18:00:00Z')
    ).body.id;
    const c = (await claim('admin1', res)).body.claimId;
    expect((await decide('faculty1', c, 'withdraw')).status).toBe(403);
    expect((await decide('admin1', c, 'withdraw')).body.status).toBe('WITHDRAWN');
  });
});

describe('notifications (stream → onChange)', () => {
  it('writes in-app notifications for owner/claimant, idempotent per event id', async () => {
    const seen: ChangeRecord[] = [];
    const poller = createStreamPoller(
      t.db,
      ENDPOINT,
      async (records) => {
        seen.push(...records);
        return onChange({ db: t.db, log: silent }, records);
      },
      { start: 'TRIM_HORIZON' },
    );
    // Drain the stream: stop after two consecutive empty polls.
    for (let i = 0, idle = 0; i < 50 && idle < 2; i++)
      idle = (await poller.tick()) > 0 ? 0 : idle + 1;

    const types = async (u: string) =>
      (await t.req(u, 'GET', '/me/notifications')).body.notifications.map(
        (n: { type: string }) => n.type,
      );
    expect(await types('student1')).toEqual(expect.arrayContaining(['claim.received']));
    expect(await types('student2')).toEqual(
      expect.arrayContaining(['claim.approved', 'claim.denied', 'reservation.transferred']),
    );
    expect(await types('admin1')).toContain('claim.denied');

    expect(await onChange({ db: t.db, log: silent }, seen)).toBe(0); // replayed stream → no duplicates

    const read = await t.req('student2', 'POST', '/me/notifications/read', { all: true });
    expect(read.body.updated).toBeGreaterThan(0);
    const after = (await t.req('student2', 'GET', '/me/notifications')).body.notifications;
    expect(after.every((n: { read: boolean }) => n.read)).toBe(true);
  });

  it('rejects a cursor for someone else’s partition', async () => {
    const forged = Buffer.from(JSON.stringify({ PK: 'USER#student1', SK: 'NOTIF#x' })).toString(
      'base64url',
    );
    expect((await t.req('student2', 'GET', `/me/notifications?cursor=${forged}`)).status).toBe(400);
  });
});

describe('demo controls', () => {
  it('admin only', async () => {
    expect(
      (await t.req('student1', 'POST', '/demo/fast-forward', { reservationId: r1 })).status,
    ).toBe(403);
  });

  it('inject-conflict releases a reservation via BR-9', async () => {
    const res = (
      await t.reserve('tutor1', 'MORRILL-0101', '2026-11-19T15:00:00Z', '2026-11-19T16:00:00Z')
    ).body.id;
    const r = await t.req('admin1', 'POST', '/demo/inject-conflict', { reservationId: res });
    expect(r.body).toMatchObject({ status: 'RELEASED', releaseReason: 'CLASS_CONFLICT' });
  });

  it('fast-forward runs the sweeper at that reservation’s cutoff', async () => {
    const res = (
      await t.reserve('tutor1', 'MORRILL-0111', '2026-11-19T15:00:00Z', '2026-11-19T16:00:00Z')
    ).body.id;
    const r = await t.req('admin1', 'POST', '/demo/fast-forward', { reservationId: res });
    expect(r.body).toMatchObject({ released: 1, status: 'RELEASED', releaseReason: 'UNCONFIRMED' });
  });
});

describe('sweeper (BR-6)', () => {
  it('releases unconfirmed reservations and expires pending claims at cutoff, idempotently', async () => {
    const res = (
      await t.reserve('student2', 'TOBIN-0101', '2026-11-20T15:00:00Z', '2026-11-20T16:00:00Z')
    ).body;
    expect(res.status).toBe('PENDING_CONFIRMATION');
    const c = (await claim('student1', res.id)).body.claimId;

    const before = await sweep(t.db, new Date('2026-11-20T10:59:59.999Z'), {
      reservationId: res.id,
    });
    expect(before).toEqual({ released: 0, expired: 0 });

    const cutoff = new Date('2026-11-20T11:00:00.000Z');
    const first = await sweep(t.db, cutoff);
    expect(first.released).toBeGreaterThanOrEqual(1);
    expect(first.expired).toBeGreaterThanOrEqual(1);
    expect((await t.req('student2', 'GET', `/reservations/${res.id}`)).body).toMatchObject({
      status: 'RELEASED',
      releaseReason: 'UNCONFIRMED',
    });
    const outgoing = (await t.req('student1', 'GET', '/me/claims?direction=outgoing')).body.claims;
    expect(outgoing.find((x: { claimId: string }) => x.claimId === c).status).toBe('EXPIRED');
    const locks = await getLocks(t.db, [
      { roomId: 'TOBIN-0101', slotIso: '2026-11-20T15:00:00.000Z' },
    ]);
    expect(locks.size).toBe(0);

    expect(await sweep(t.db, cutoff)).toEqual({ released: 0, expired: 0 });
  });

  it('reset wipes reservations (admin)', async () => {
    const r = await t.req('admin1', 'POST', '/demo/reset');
    expect(r.body.deleted).toBeGreaterThan(0);
    expect((await t.req('student2', 'GET', '/me/reservations')).body.reservations).toEqual([]);
  });
});
