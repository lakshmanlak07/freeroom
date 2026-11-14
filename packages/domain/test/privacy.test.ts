import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { ReservationItemSchema } from '@freeroom/shared';
import { assertNoPII, findPIIPaths, toPublicUser, toReservationItem } from '../src/privacy';

const now = new Date('2026-11-16T12:00:00Z');
const base = {
  id: 'r1',
  roomId: 'R1',
  start: new Date('2026-11-17T19:00:00Z'),
  end: new Date('2026-11-17T20:00:00Z'),
  status: 'CONFIRMED' as const,
};

describe('assertNoPII', () => {
  it('finds PII keys at any depth, including arrays', () => {
    expect(findPIIPaths({ a: { b: [{ email: 'x' }] }, phone: '1' })).toEqual([
      'a.b.0.email',
      'phone',
    ]);
    expect(() => assertNoPII({ owner: { uidHash: 'h' } })).toThrow(/owner\.uidHash/);
    expect(() => assertNoPII({ ok: true, items: [1, 'a', null] })).not.toThrow();
  });
});

describe('public projections (BR-5)', () => {
  it('reservation item exposes alias, never identity', () => {
    const item = toReservationItem(
      { ...base, ownerId: 'u1' },
      { displayAlias: 'Night Owl', role: 'STUDENT' },
      'viewer',
      now,
    );
    expect(ReservationItemSchema.parse(item)).toEqual(item);
    expect(item).toMatchObject({ ownerAlias: 'Night Owl', isMine: false, claimable: true });
    expect(JSON.stringify(item)).not.toContain('u1');
  });

  it('own reservation is not claimable by me', () => {
    const item = toReservationItem(
      { ...base, ownerId: 'me' },
      { displayAlias: 'Me', role: 'STUDENT' },
      'me',
      now,
    );
    expect(item).toMatchObject({ isMine: true, claimable: false });
  });

  // Sentinel-prefixed PII values so we can prove they never appear in the output.
  const pii = fc.string({ minLength: 1, maxLength: 20 }).map((s) => `__pii__${s}`);
  const safe = fc.string({ maxLength: 20 }).filter((s) => !s.includes('__pii__'));
  const extras = fc.dictionary(fc.string({ maxLength: 12 }), fc.anything());

  it('property: projections never contain PII keys or values, whatever the input carries', () => {
    fc.assert(
      fc.property(
        pii,
        pii,
        pii,
        pii,
        safe,
        extras,
        (universityId, uidHash, email, phone, alias, extra) => {
          const owner = {
            ...extra,
            displayAlias: alias,
            role: 'STUDENT' as const,
            universityId,
            uidHash,
            email,
            phone,
            emailEnc: email,
            phoneEnc: phone,
            contact: { email, phone },
          };
          const res = { ...extra, ...base, ownerId: 'u1', universityId, email };
          for (const out of [toReservationItem(res, owner, 'v', now), toPublicUser(owner)]) {
            expect(findPIIPaths(out)).toEqual([]);
            expect(JSON.stringify(out)).not.toContain('__pii__');
          }
        },
      ),
    );
  });
});
