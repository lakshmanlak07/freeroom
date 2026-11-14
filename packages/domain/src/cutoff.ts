/**
 * BR-6. All comparisons use real instants: cutoff is exactly 4 real hours before start,
 * regardless of DST. The API must ALSO enforce `cutoffAt > :now` inside the conditional write.
 */
import type { ClaimStatus, ReservationStatus } from '@freeroom/shared';
import { err, ok, type Result } from './result';
import { addHours } from './time';

export const CUTOFF_HOURS = 4;
export const CONFIRM_WINDOW_HOURS = 24;

export const ACTIVE_RESERVATION_STATUSES: readonly ReservationStatus[] = [
  'PENDING_CONFIRMATION',
  'CONFIRMED',
];
const isActive = (s: ReservationStatus) => ACTIVE_RESERVATION_STATUSES.includes(s);

interface ResLike {
  status: ReservationStatus;
  start: Date;
}

export const cutoffAt = (start: Date): Date => addHours(start, -CUTOFF_HOURS);
export const confirmWindowOpensAt = (start: Date): Date => addHours(start, -CONFIRM_WINDOW_HOURS);
const beforeCutoff = (start: Date, now: Date) => now.getTime() < cutoffAt(start).getTime();

/** Created at/after T−24h counts as confirmed. */
export const initialStatusOnCreate = (
  start: Date,
  now: Date,
): 'CONFIRMED' | 'PENDING_CONFIRMATION' =>
  now.getTime() >= confirmWindowOpensAt(start).getTime() ? 'CONFIRMED' : 'PENDING_CONFIRMATION';

export const isClaimable = (res: ResLike, now: Date): boolean =>
  isActive(res.status) && beforeCutoff(res.start, now);

/** Owner confirms within [T−24h, cutoff). */
export function canConfirm(res: ResLike, now: Date): Result {
  if (res.status !== 'PENDING_CONFIRMATION') return err('INVALID_TRANSITION');
  if (!beforeCutoff(res.start, now)) return err('CUTOFF_PASSED');
  if (now.getTime() < confirmWindowOpensAt(res.start).getTime()) return err('TOO_EARLY');
  return ok();
}

export function canSubmitClaim(
  res: ResLike & { ownerId: string },
  requesterId: string,
  now: Date,
): Result {
  if (res.ownerId === requesterId) return err('OWN_RESERVATION');
  if (!isActive(res.status)) return err('NOT_CLAIMABLE');
  if (!beforeCutoff(res.start, now)) return err('CUTOFF_PASSED');
  return ok();
}

/** No acceptance is ever allowed at or after cutoff. */
export function canApproveClaim(claim: { status: ClaimStatus }, res: ResLike, now: Date): Result {
  if (claim.status !== 'PENDING') return err('INVALID_TRANSITION');
  if (!isActive(res.status)) return err('NOT_CLAIMABLE');
  if (!beforeCutoff(res.start, now)) return err('CUTOFF_PASSED');
  return ok();
}

/** Sweeper: unconfirmed at cutoff → RELEASED (UNCONFIRMED). */
export const shouldAutoRelease = (res: ResLike, now: Date): boolean =>
  res.status === 'PENDING_CONFIRMATION' && !beforeCutoff(res.start, now);

/** Sweeper: PENDING claims at cutoff → EXPIRED (reservation stays with owner). */
export const shouldExpireClaim = (claim: { status: ClaimStatus }, res: ResLike, now: Date) =>
  claim.status === 'PENDING' && !beforeCutoff(res.start, now);
