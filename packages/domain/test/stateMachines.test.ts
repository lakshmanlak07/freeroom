import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { ClaimStatusSchema, ReservationStatusSchema } from '@freeroom/shared';
import {
  CLAIM_ACTIONS,
  RESERVATION_ACTIONS,
  transitionClaim,
  transitionReservation,
} from '../src/stateMachines';

describe('reservation state machine', () => {
  it.each([
    ['PENDING_CONFIRMATION', 'CONFIRM', 'CONFIRMED'],
    ['PENDING_CONFIRMATION', 'CANCEL', 'CANCELLED'],
    ['PENDING_CONFIRMATION', 'RELEASE', 'RELEASED'],
    ['PENDING_CONFIRMATION', 'CONFLICT', 'CONFLICTED'],
    ['PENDING_CONFIRMATION', 'TRANSFER', 'CONFIRMED'],
    ['CONFIRMED', 'CANCEL', 'CANCELLED'],
    ['CONFIRMED', 'RELEASE', 'RELEASED'],
    ['CONFIRMED', 'CONFLICT', 'CONFLICTED'],
    ['CONFIRMED', 'COMPLETE', 'COMPLETED'],
    ['CONFIRMED', 'TRANSFER', 'CONFIRMED'],
    ['CONFLICTED', 'RELEASE', 'RELEASED'],
  ] as const)('%s --%s--> %s', (from, action, to) => {
    expect(transitionReservation(from, action)).toEqual({ ok: true, value: to });
  });

  it.each([
    ['CONFIRMED', 'CONFIRM'],
    ['PENDING_CONFIRMATION', 'COMPLETE'],
    ['CONFLICTED', 'CONFIRM'],
    ['CONFLICTED', 'CANCEL'],
    ['RELEASED', 'CONFIRM'],
    ['CANCELLED', 'TRANSFER'],
  ] as const)('rejects %s --%s', (from, action) => {
    expect(transitionReservation(from, action)).toMatchObject({
      ok: false,
      code: 'INVALID_TRANSITION',
    });
  });

  it('property: terminal states accept no action', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('RELEASED', 'CANCELLED', 'COMPLETED' as const),
        fc.constantFrom(...RESERVATION_ACTIONS),
        (from, action) => {
          expect(transitionReservation(from, action).ok).toBe(false);
        },
      ),
    );
  });

  it('property: every result is a valid status', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ReservationStatusSchema.options),
        fc.constantFrom(...RESERVATION_ACTIONS),
        (from, action) => {
          const r = transitionReservation(from, action);
          if (r.ok) expect(ReservationStatusSchema.options).toContain(r.value);
        },
      ),
    );
  });
});

describe('claim state machine', () => {
  it.each([
    ['APPROVE', 'APPROVED'],
    ['DENY', 'DENIED'],
    ['EXPIRE', 'EXPIRED'],
    ['WITHDRAW', 'WITHDRAWN'],
  ] as const)('PENDING --%s--> %s', (action, to) => {
    expect(transitionClaim('PENDING', action)).toEqual({ ok: true, value: to });
  });

  it('property: only PENDING can move', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ClaimStatusSchema.options.filter((s) => s !== 'PENDING')),
        fc.constantFrom(...CLAIM_ACTIONS),
        (from, action) => {
          expect(transitionClaim(from, action)).toMatchObject({
            ok: false,
            code: 'INVALID_TRANSITION',
          });
        },
      ),
    );
  });
});
