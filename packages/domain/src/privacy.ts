/**
 * BR-5. Public projections are allowlists: they copy named fields only, so nothing new on
 * the source record can leak. assertNoPII is the contract-test guard for every API response.
 */
import type { ReservationItem, ReservationStatus, Role } from '@freeroom/shared';
import { isClaimable } from './cutoff';

export const PII_KEYS: ReadonlySet<string> = new Set([
  'universityId',
  'uidHash',
  'email',
  'phone',
  'emailEnc',
  'phoneEnc',
  'contact',
]);

export function findPIIPaths(value: unknown, path = ''): string[] {
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([k, v]) => {
    const p = path ? `${path}.${k}` : k;
    return PII_KEYS.has(k) ? [p] : findPIIPaths(v, p);
  });
}

export function assertNoPII(value: unknown): void {
  const paths = findPIIPaths(value);
  if (paths.length) throw new Error(`PII in response at: ${paths.join(', ')}`);
}

export interface PublicUser {
  displayAlias: string;
  role: Role;
}

export const toPublicUser = (u: PublicUser): PublicUser => ({
  displayAlias: u.displayAlias,
  role: u.role,
});

export function toReservationItem(
  res: {
    id: string;
    roomId: string;
    ownerId: string;
    start: Date;
    end: Date;
    status: ReservationStatus;
  },
  owner: PublicUser,
  viewerId: string,
  now: Date,
): ReservationItem {
  const isMine = res.ownerId === viewerId;
  return {
    kind: 'reservation',
    id: res.id,
    roomId: res.roomId,
    start: res.start.toISOString(),
    end: res.end.toISOString(),
    status: res.status,
    ownerAlias: owner.displayAlias,
    isMine,
    claimable: !isMine && isClaimable(res, now),
  };
}
