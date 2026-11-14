import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROLE_LIMITS,
  MAX_OPEN_CLAIMS,
  can,
  checkOpenClaims,
  checkQuota,
  type Actor,
} from '../src/permissions';

const student: Actor = { userId: 's1', role: 'STUDENT' };
const faculty: Actor = { userId: 'f1', role: 'FACULTY' };
const tutor: Actor = { userId: 't1', role: 'TUTOR' };
const admin: Actor = { userId: 'a1', role: 'ADMIN' };

describe('role limits (PRD §2.1)', () => {
  it.each([
    ['STUDENT', 2, 180],
    ['FACULTY', 5, 240],
    ['TUTOR', 3, 180],
  ] as const)('%s: max %i active, ≤ %i min', (role, maxActive, maxMin) => {
    expect(DEFAULT_ROLE_LIMITS[role]).toEqual({ maxActive, maxDurationMinutes: maxMin });
    expect(checkQuota(role, maxActive - 1).ok).toBe(true);
    expect(checkQuota(role, maxActive)).toMatchObject({ ok: false, code: 'QUOTA_EXCEEDED' });
  });

  it('admin has no active quota', () => {
    expect(checkQuota('ADMIN', 10_000).ok).toBe(true);
  });

  it('accepts config overrides (SSM)', () => {
    const limits = { ...DEFAULT_ROLE_LIMITS, STUDENT: { maxActive: 1, maxDurationMinutes: 60 } };
    expect(checkQuota('STUDENT', 1, limits).ok).toBe(false);
  });

  it('limits open claims to 3', () => {
    expect(checkOpenClaims(MAX_OPEN_CLAIMS - 1).ok).toBe(true);
    expect(checkOpenClaims(MAX_OPEN_CLAIMS)).toMatchObject({ ok: false, code: 'QUOTA_EXCEEDED' });
  });
});

describe('can()', () => {
  const ownRes = { ownerId: 's1' };
  const otherRes = { ownerId: 'x' };

  it('everyone browses, creates, submits claims', () => {
    for (const a of [student, faculty, tutor, admin]) {
      expect(can(a, 'room:browse')).toBe(true);
      expect(can(a, 'reservation:create')).toBe(true);
      expect(can(a, 'claim:submit')).toBe(true);
    }
  });

  it('only owner (or admin) cancels and decides claims', () => {
    expect(can(student, 'reservation:cancel', ownRes)).toBe(true);
    expect(can(student, 'reservation:cancel', otherRes)).toBe(false);
    expect(can(student, 'claim:decide', ownRes)).toBe(true);
    expect(can(faculty, 'claim:decide', otherRes)).toBe(false);
    expect(can(tutor, 'reservation:cancel')).toBe(false);
    expect(can(admin, 'reservation:cancel', otherRes)).toBe(true);
    expect(can(admin, 'claim:decide', otherRes)).toBe(true);
  });

  it('only requester withdraws', () => {
    expect(can(student, 'claim:withdraw', { requesterId: 's1' })).toBe(true);
    expect(can(student, 'claim:withdraw', { requesterId: 'x' })).toBe(false);
  });

  it('admin-only actions', () => {
    for (const action of ['admin:forceRelease', 'admin:suspend', 'admin:audit'] as const) {
      expect(can(admin, action)).toBe(true);
      for (const a of [student, faculty, tutor]) expect(can(a, action)).toBe(false);
    }
  });
});
