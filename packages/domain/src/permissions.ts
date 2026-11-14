/** PRD §2.1. Limits are defaults; the API passes SSM-sourced overrides. */
import type { Role } from '@freeroom/shared';
import { err, ok, type Result } from './result';

export interface RoleLimits {
  maxActive: number;
  maxDurationMinutes: number;
}

export const DEFAULT_ROLE_LIMITS: Readonly<Record<Role, RoleLimits>> = {
  STUDENT: { maxActive: 2, maxDurationMinutes: 180 },
  FACULTY: { maxActive: 5, maxDurationMinutes: 240 },
  TUTOR: { maxActive: 3, maxDurationMinutes: 180 },
  ADMIN: { maxActive: Infinity, maxDurationMinutes: 240 }, // 240 = 16 slot locks max (§6.2)
};

export const MAX_OPEN_CLAIMS = 3;

export interface Actor {
  userId: string;
  role: Role;
}

export type Action =
  | 'room:browse'
  | 'reservation:create'
  | 'reservation:cancel'
  | 'claim:submit'
  | 'claim:decide'
  | 'claim:withdraw'
  | 'admin:forceRelease'
  | 'admin:suspend'
  | 'admin:audit';

/** Authorization lives in the domain, not only in route guards (PRD §9). */
export function can(
  actor: Actor,
  action: Action,
  resource: { ownerId?: string; requesterId?: string } = {},
): boolean {
  if (actor.role === 'ADMIN') return true;
  switch (action) {
    case 'reservation:cancel':
    case 'claim:decide':
      return resource.ownerId === actor.userId;
    case 'claim:withdraw':
      return resource.requesterId === actor.userId;
    case 'admin:forceRelease':
    case 'admin:suspend':
    case 'admin:audit':
      return false;
    default:
      return true;
  }
}

export function checkQuota(
  role: Role,
  activeCount: number,
  limits: Readonly<Record<Role, RoleLimits>> = DEFAULT_ROLE_LIMITS,
): Result {
  const { maxActive } = limits[role];
  return activeCount < maxActive ? ok() : err('QUOTA_EXCEEDED', { maxActive });
}

export const checkOpenClaims = (openCount: number): Result =>
  openCount < MAX_OPEN_CLAIMS ? ok() : err('QUOTA_EXCEEDED', { maxOpenClaims: MAX_OPEN_CLAIMS });
