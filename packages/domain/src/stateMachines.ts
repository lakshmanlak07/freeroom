/** PRD §6.4 state machines as transition tables. Missing entry = illegal (INVALID_TRANSITION). */
import type { ClaimStatus, ReservationStatus } from '@freeroom/shared';
import { err, ok, type Result } from './result';

export const RESERVATION_ACTIONS = [
  'CONFIRM',
  'CANCEL',
  'RELEASE',
  'CONFLICT',
  'COMPLETE',
  'TRANSFER',
] as const;
export type ReservationAction = (typeof RESERVATION_ACTIONS)[number];

export const RESERVATION_TRANSITIONS: Readonly<
  Record<ReservationStatus, Partial<Record<ReservationAction, ReservationStatus>>>
> = {
  PENDING_CONFIRMATION: {
    CONFIRM: 'CONFIRMED',
    CANCEL: 'CANCELLED',
    RELEASE: 'RELEASED', // UNCONFIRMED / ADMIN
    CONFLICT: 'CONFLICTED',
    TRANSFER: 'CONFIRMED', // new owner holds a confirmed reservation
  },
  CONFIRMED: {
    CANCEL: 'CANCELLED',
    RELEASE: 'RELEASED',
    CONFLICT: 'CONFLICTED',
    COMPLETE: 'COMPLETED',
    TRANSFER: 'CONFIRMED',
  },
  CONFLICTED: { RELEASE: 'RELEASED' }, // BR-9: CONFLICTED → RELEASED (CLASS_CONFLICT)
  RELEASED: {},
  CANCELLED: {},
  COMPLETED: {},
};

export const CLAIM_ACTIONS = ['APPROVE', 'DENY', 'EXPIRE', 'WITHDRAW'] as const;
export type ClaimAction = (typeof CLAIM_ACTIONS)[number];

export const CLAIM_TRANSITIONS: Readonly<
  Record<ClaimStatus, Partial<Record<ClaimAction, ClaimStatus>>>
> = {
  PENDING: { APPROVE: 'APPROVED', DENY: 'DENIED', EXPIRE: 'EXPIRED', WITHDRAW: 'WITHDRAWN' },
  APPROVED: {},
  DENIED: {},
  EXPIRED: {},
  WITHDRAWN: {},
};

function step<S extends string, A extends string>(
  table: Readonly<Record<S, Partial<Record<A, S>>>>,
  from: S,
  action: A,
): Result<S> {
  const to = table[from][action];
  return to ? ok(to) : err('INVALID_TRANSITION', { from, action });
}

export const transitionReservation = (from: ReservationStatus, action: ReservationAction) =>
  step(RESERVATION_TRANSITIONS, from, action);

export const transitionClaim = (from: ClaimStatus, action: ClaimAction) =>
  step(CLAIM_TRANSITIONS, from, action);
