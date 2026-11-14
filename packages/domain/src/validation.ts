import type { Role } from '@freeroom/shared';
import { findClassConflicts, type ClassEvent } from './classConflict';
import { DEFAULT_ROLE_LIMITS, type RoleLimits } from './permissions';
import { err, ok, type Result } from './result';
import { HOUR_MS, MINUTE_MS, durationMs, isSlotAligned, type Interval } from './time';

export const HORIZON_DAYS = 7;

export interface ReservationRequestCtx {
  role: Role;
  now: Date;
  /** Fresh 25Live classes for the room/day(s). */
  classes: readonly ClassEvent[];
  limits?: Readonly<Record<Role, RoleLimits>>;
}

/** Pure pre-write checks. BR-8 (double booking) is enforced by the DB transaction, not here. */
export function validateReservationRequest(
  req: Interval & { roomId: string },
  ctx: ReservationRequestCtx,
): Result {
  const { start, end } = req;
  if (!isSlotAligned(start) || !isSlotAligned(end) || durationMs(req) <= 0) {
    return err('INVALID_SLOT_BOUNDARY');
  }
  if (start.getTime() < ctx.now.getTime()) return err('IN_PAST');
  if (start.getTime() - ctx.now.getTime() > HORIZON_DAYS * 24 * HOUR_MS) {
    return err('BEYOND_HORIZON', { horizonDays: HORIZON_DAYS });
  }
  const maxMinutes = (ctx.limits ?? DEFAULT_ROLE_LIMITS)[ctx.role].maxDurationMinutes;
  if (durationMs(req) > maxMinutes * MINUTE_MS) return err('DURATION_EXCEEDED', { maxMinutes });

  const conflicts = findClassConflicts(req, ctx.classes);
  if (conflicts.length > 0) {
    return err('CLASS_CONFLICT', {
      classes: conflicts.map((c) => ({
        ...c,
        start: c.start.toISOString(),
        end: c.end.toISOString(),
      })),
    });
  }
  return ok();
}
