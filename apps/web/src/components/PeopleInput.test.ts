import { describe, expect, it } from 'vitest';
import { checkPeople } from './PeopleInput';

describe('checkPeople', () => {
  it('accepts whole numbers within bounds', () => {
    expect(checkPeople('24')).toEqual({ ok: true, value: 24 });
    expect(checkPeople(' 1 ')).toEqual({ ok: true, value: 1 });
    expect(checkPeople('500')).toEqual({ ok: true, value: 500 });
  });
  it('rejects below min, above max, and non-integers', () => {
    expect(checkPeople('0')).toMatchObject({ ok: false, error: 'At least 1.' });
    expect(checkPeople('501')).toMatchObject({ ok: false, error: 'At most 500.' });
    expect(checkPeople('31', { max: 30 })).toMatchObject({
      ok: false,
      error: 'At most 30 (room seats).',
    });
    for (const bad of ['2.5', '-3', 'six', '1e3']) expect(checkPeople(bad).ok).toBe(false);
  });
  it('empty is "any" only when allowed', () => {
    expect(checkPeople('', { allowEmpty: true })).toEqual({ ok: true, value: null });
    expect(checkPeople('')).toMatchObject({ ok: false, error: 'Enter a number.' });
  });
});
