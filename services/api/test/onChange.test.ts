import { marshall } from '@aws-sdk/util-dynamodb';
import { describe, expect, it } from 'vitest';
import { fromStreamRecord, mapRecord, type ChangeRecord } from '../src/notify/onChange';

const AT = '2026-11-16T12:00:00.000Z';
const evt = (type: string, extra: Record<string, unknown> = {}): ChangeRecord => ({
  eventName: 'INSERT',
  newImage: {
    PK: 'RES#r1',
    SK: `EVT#${AT}#0-e1`,
    eventId: 'e1',
    reservationId: 'r1',
    at: AT,
    type,
    notify: ['owner'],
    ...extra,
  },
});

describe('onChange mapping table', () => {
  it.each([
    ['CLAIM_REQUESTED', {}, 'claim.received'],
    ['CLAIM_APPROVED', { data: { mode: 'SHARE_CONTACT' } }, 'claim.approved'],
    ['CLAIM_DENIED', {}, 'claim.denied'],
    ['CLAIM_EXPIRED', {}, 'claim.expired'],
    ['TRANSFERRED', {}, 'reservation.transferred'],
    ['RELEASED', { reason: 'UNCONFIRMED' }, 'reservation.auto_released'],
    [
      'RELEASED',
      { reason: 'CLASS_CONFLICT', data: { class: { name: 'Calc I' }, alternatives: [] } },
      'reservation.class_conflict',
    ],
  ])('%s %j → %s', (type, extra, expected) => {
    const [n] = mapRecord(evt(type, extra));
    expect(n).toMatchObject({
      userId: 'owner',
      type: expected,
      reservationId: 'r1',
      notifId: `${AT}#e1`,
      createdAt: AT,
    });
  });

  it.each([['CREATED'], ['CONFIRMED'], ['CANCELLED'], ['CONFLICTED']])(
    '%s → no notification',
    (type) => {
      expect(mapRecord(evt(type))).toEqual([]);
    },
  );

  it('ignores non-INSERTs, non-event items, admin releases and events with no recipients', () => {
    expect(mapRecord({ ...evt('CLAIM_DENIED'), eventName: 'MODIFY' })).toEqual([]);
    expect(
      mapRecord({
        eventName: 'INSERT',
        newImage: { PK: 'RES#r1', SK: 'META', type: 'CLAIM_DENIED' },
      }),
    ).toEqual([]);
    expect(mapRecord(evt('RELEASED', { reason: 'ADMIN' }))).toEqual([]);
    expect(mapRecord(evt('CLAIM_DENIED', { notify: undefined }))).toEqual([]);
    expect(mapRecord({ eventName: 'REMOVE', oldImage: evt('CLAIM_DENIED').newImage })).toEqual([]);
  });

  it('fans out to every recipient once, with alternatives on class conflicts', () => {
    const alts = [
      {
        roomId: 'R2',
        name: 'R2',
        buildingId: 'B',
        buildingName: 'B',
        capacity: 9,
        start: AT,
        end: AT,
      },
    ];
    const out = mapRecord(
      evt('RELEASED', {
        reason: 'CLASS_CONFLICT',
        notify: ['a', 'b', 'a'],
        data: { class: { name: 'X' }, alternatives: alts },
      }),
    );
    expect(out.map((n) => n.userId)).toEqual(['a', 'b']);
    expect(out[0]).toMatchObject({
      alternatives: alts,
      body: expect.stringContaining('X was scheduled'),
    });
    expect(mapRecord(evt('CLAIM_APPROVED', { data: { mode: 'TRANSFER' } }))[0]!.body).toMatch(
      /now yours/,
    );
  });

  it('unmarshalls Lambda stream records (sets included)', () => {
    const image = { ...evt('CLAIM_DENIED').newImage!, notify: new Set(['owner']) };
    const rec = fromStreamRecord({
      eventName: 'INSERT',
      dynamodb: { NewImage: marshall(image) as never },
    });
    expect(mapRecord(rec).map((n) => n.userId)).toEqual(['owner']);
  });
});
