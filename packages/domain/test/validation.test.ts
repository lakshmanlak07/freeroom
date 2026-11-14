import { describe, expect, it } from 'vitest';
import { validateReservationRequest } from '../src/validation';
import type { ClassEvent } from '../src/classConflict';

const now = new Date('2026-11-16T13:07:00Z');
const t = (iso: string) => new Date(iso);
const req = (s: string, e: string) => ({ roomId: 'R1', start: t(s), end: t(e) });
const classes: ClassEvent[] = [
  {
    eventId: 'c1',
    roomId: 'R1',
    name: 'Intro to CS',
    start: t('2026-11-16T16:00Z'),
    end: t('2026-11-16T17:15Z'),
  },
];
const ctx = { role: 'STUDENT' as const, now, classes };

describe('validateReservationRequest', () => {
  it('accepts a valid request', () => {
    expect(validateReservationRequest(req('2026-11-16T14:00Z', '2026-11-16T16:00Z'), ctx).ok).toBe(
      true,
    );
  });
  it('rejects off-boundary start or end', () => {
    expect(
      validateReservationRequest(req('2026-11-16T14:05Z', '2026-11-16T15:00Z'), ctx),
    ).toMatchObject({
      ok: false,
      code: 'INVALID_SLOT_BOUNDARY',
    });
    expect(
      validateReservationRequest(req('2026-11-16T14:00Z', '2026-11-16T15:01Z'), ctx),
    ).toMatchObject({
      code: 'INVALID_SLOT_BOUNDARY',
    });
  });
  it('rejects end <= start', () => {
    expect(
      validateReservationRequest(req('2026-11-16T15:00Z', '2026-11-16T15:00Z'), ctx),
    ).toMatchObject({
      code: 'INVALID_SLOT_BOUNDARY',
    });
  });
  it('rejects past starts', () => {
    expect(
      validateReservationRequest(req('2026-11-16T13:00Z', '2026-11-16T14:00Z'), ctx),
    ).toMatchObject({
      code: 'IN_PAST',
    });
  });
  it('enforces the 7-day horizon', () => {
    expect(validateReservationRequest(req('2026-11-23T13:00Z', '2026-11-23T14:00Z'), ctx).ok).toBe(
      true,
    );
    expect(
      validateReservationRequest(req('2026-11-23T13:15Z', '2026-11-23T14:00Z'), ctx),
    ).toMatchObject({
      code: 'BEYOND_HORIZON',
    });
  });
  it('enforces role max duration', () => {
    expect(validateReservationRequest(req('2026-11-17T14:00Z', '2026-11-17T17:00Z'), ctx).ok).toBe(
      true,
    );
    expect(
      validateReservationRequest(req('2026-11-17T14:00Z', '2026-11-17T17:15Z'), ctx),
    ).toMatchObject({
      code: 'DURATION_EXCEEDED',
      details: { maxMinutes: 180 },
    });
    expect(
      validateReservationRequest(req('2026-11-17T14:00Z', '2026-11-17T18:00Z'), {
        ...ctx,
        role: 'FACULTY',
      }).ok,
    ).toBe(true);
  });
  it('rejects class conflicts with class details', () => {
    const r = validateReservationRequest(req('2026-11-16T15:30Z', '2026-11-16T16:15Z'), ctx);
    expect(r).toMatchObject({
      ok: false,
      code: 'CLASS_CONFLICT',
      details: {
        classes: [{ eventId: 'c1', name: 'Intro to CS', start: '2026-11-16T16:00:00.000Z' }],
      },
    });
  });
});
