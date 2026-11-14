import { describe, expect, it } from 'vitest';
import {
  canApproveClaim,
  canConfirm,
  canSubmitClaim,
  confirmWindowOpensAt,
  cutoffAt,
  initialStatusOnCreate,
  isClaimable,
  shouldAutoRelease,
  shouldExpireClaim,
} from '../src/cutoff';
import { formatCampus } from '../src/time';

const H = 3_600_000;
const start = new Date('2026-11-20T19:00:00Z'); // 2pm EST
const cutoff = new Date(start.getTime() - 4 * H);
const ms = (d: Date, delta: number) => new Date(d.getTime() + delta);

const pending = { status: 'PENDING_CONFIRMATION' as const, start, ownerId: 'owner' };
const confirmed = { ...pending, status: 'CONFIRMED' as const };

describe('BR-6 cutoff = start − 4h', () => {
  it('computes cutoff and confirm window', () => {
    expect(cutoffAt(start)).toEqual(cutoff);
    expect(confirmWindowOpensAt(start)).toEqual(new Date(start.getTime() - 24 * H));
  });

  it('is exactly 4 real hours across spring-forward (wall clock shows 5h)', () => {
    const s = new Date('2026-03-08T08:00:00Z'); // 04:00 EDT, after the 02:00→03:00 jump
    const c = cutoffAt(s);
    expect(s.getTime() - c.getTime()).toBe(4 * H);
    expect(formatCampus(c, 'yyyy-MM-dd HH:mm xxx')).toBe('2026-03-07 23:00 -05:00');
  });

  it('is exactly 4 real hours across fall-back (wall clock shows 3h)', () => {
    const s = new Date('2026-11-01T08:00:00Z'); // 03:00 EST
    const c = cutoffAt(s);
    expect(s.getTime() - c.getTime()).toBe(4 * H);
    expect(formatCampus(c, 'yyyy-MM-dd HH:mm xxx')).toBe('2026-11-01 00:00 -04:00');
  });
});

describe('canConfirm', () => {
  it('allows at cutoff − 1ms', () => {
    expect(canConfirm(pending, ms(cutoff, -1)).ok).toBe(true);
  });
  it('rejects at cutoff with CUTOFF_PASSED', () => {
    expect(canConfirm(pending, cutoff)).toMatchObject({ ok: false, code: 'CUTOFF_PASSED' });
  });
  it('rejects after cutoff', () => {
    expect(canConfirm(pending, ms(start, 1))).toMatchObject({ ok: false, code: 'CUTOFF_PASSED' });
  });
  it('allows exactly when the window opens (T − 24h)', () => {
    expect(canConfirm(pending, confirmWindowOpensAt(start)).ok).toBe(true);
  });
  it('rejects before the window with TOO_EARLY', () => {
    expect(canConfirm(pending, ms(confirmWindowOpensAt(start), -1))).toMatchObject({
      ok: false,
      code: 'TOO_EARLY',
    });
  });
  it('rejects non-pending reservations', () => {
    expect(canConfirm(confirmed, ms(cutoff, -H))).toMatchObject({
      ok: false,
      code: 'INVALID_TRANSITION',
    });
  });
});

describe('canSubmitClaim', () => {
  it('allows at cutoff − 1ms', () => {
    expect(canSubmitClaim(confirmed, 'req', ms(cutoff, -1)).ok).toBe(true);
    expect(canSubmitClaim(pending, 'req', ms(cutoff, -1)).ok).toBe(true);
  });
  it('rejects at cutoff', () => {
    expect(canSubmitClaim(confirmed, 'req', cutoff)).toMatchObject({
      ok: false,
      code: 'CUTOFF_PASSED',
    });
  });
  it('rejects own reservation', () => {
    expect(canSubmitClaim(confirmed, 'owner', ms(cutoff, -H))).toMatchObject({
      ok: false,
      code: 'OWN_RESERVATION',
    });
  });
  it('rejects inactive reservations', () => {
    for (const status of ['RELEASED', 'CANCELLED', 'COMPLETED', 'CONFLICTED'] as const) {
      expect(canSubmitClaim({ ...confirmed, status }, 'req', ms(cutoff, -H))).toMatchObject({
        ok: false,
        code: 'NOT_CLAIMABLE',
      });
    }
  });
});

describe('canApproveClaim', () => {
  const claim = { status: 'PENDING' as const };
  it('allows at cutoff − 1ms', () => {
    expect(canApproveClaim(claim, confirmed, ms(cutoff, -1)).ok).toBe(true);
  });
  it('rejects at cutoff — no acceptance ever at or after cutoff', () => {
    expect(canApproveClaim(claim, confirmed, cutoff)).toMatchObject({
      ok: false,
      code: 'CUTOFF_PASSED',
    });
    expect(canApproveClaim(claim, confirmed, ms(start, H))).toMatchObject({
      ok: false,
      code: 'CUTOFF_PASSED',
    });
  });
  it('rejects non-pending claims', () => {
    expect(canApproveClaim({ status: 'DENIED' }, confirmed, ms(cutoff, -H))).toMatchObject({
      ok: false,
      code: 'INVALID_TRANSITION',
    });
  });
  it('rejects when the reservation is no longer active', () => {
    expect(
      canApproveClaim(claim, { ...confirmed, status: 'RELEASED' }, ms(cutoff, -H)),
    ).toMatchObject({
      ok: false,
      code: 'NOT_CLAIMABLE',
    });
  });
});

describe('initialStatusOnCreate / claimability', () => {
  it('is PENDING_CONFIRMATION when created before T − 24h', () => {
    expect(initialStatusOnCreate(start, ms(confirmWindowOpensAt(start), -1))).toBe(
      'PENDING_CONFIRMATION',
    );
  });
  it('is CONFIRMED when created inside 24h', () => {
    expect(initialStatusOnCreate(start, confirmWindowOpensAt(start))).toBe('CONFIRMED');
    expect(initialStatusOnCreate(start, ms(start, -10 * H))).toBe('CONFIRMED');
  });
  it('created inside 4h → CONFIRMED and not claimable', () => {
    const now = ms(start, -3 * H);
    const status = initialStatusOnCreate(start, now);
    expect(status).toBe('CONFIRMED');
    expect(isClaimable({ status, start }, now)).toBe(false);
  });
  it('is claimable before cutoff, not at cutoff', () => {
    expect(isClaimable(confirmed, ms(cutoff, -1))).toBe(true);
    expect(isClaimable(confirmed, cutoff)).toBe(false);
    expect(isClaimable({ ...confirmed, status: 'CANCELLED' }, ms(cutoff, -H))).toBe(false);
  });
});

describe('sweeper predicates', () => {
  it('auto-releases unconfirmed reservations at cutoff, not before', () => {
    expect(shouldAutoRelease(pending, ms(cutoff, -1))).toBe(false);
    expect(shouldAutoRelease(pending, cutoff)).toBe(true);
    expect(shouldAutoRelease(confirmed, cutoff)).toBe(false);
  });
  it('expires pending claims at cutoff, not before', () => {
    expect(shouldExpireClaim({ status: 'PENDING' }, confirmed, ms(cutoff, -1))).toBe(false);
    expect(shouldExpireClaim({ status: 'PENDING' }, confirmed, cutoff)).toBe(true);
    expect(shouldExpireClaim({ status: 'APPROVED' }, confirmed, cutoff)).toBe(false);
  });
});
