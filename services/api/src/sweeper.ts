/**
 * BR-6 backstop: every minute (EventBridge Scheduler), release unconfirmed reservations at cutoff
 * (UNCONFIRMED) and expire PENDING claims at cutoff. Due items come from the sparse GSI4 index.
 * Idempotent: each write is conditional, so re-runs and overlapping runs are no-ops.
 */
import { shouldAutoRelease } from '@freeroom/domain';
import { expireClaim, listDueClaims, listReservationClaims } from './data/claims';
import type { Db } from './data/db';
import { getReservation, listDueUnconfirmed, releaseUnconfirmed } from './data/reservations';

export async function sweep(db: Db, now: Date, opts: { reservationId?: string } = {}) {
  const nowIso = now.toISOString();
  const reservations = opts.reservationId
    ? [await getReservation(db, opts.reservationId)].filter((r) => r !== null)
    : await listDueUnconfirmed(db, now);
  const claims = opts.reservationId
    ? await listReservationClaims(db, opts.reservationId)
    : await listDueClaims(db, now);

  let released = 0;
  for (const r of reservations) {
    if (
      shouldAutoRelease({ status: r.status, start: new Date(r.start) }, now) &&
      (await releaseUnconfirmed(db, r, now))
    ) {
      released++;
    }
  }
  let expired = 0;
  for (const c of claims) {
    if (c.status === 'PENDING' && c.expiresAt <= nowIso && (await expireClaim(db, c, now)))
      expired++;
  }
  return { released, expired };
}
