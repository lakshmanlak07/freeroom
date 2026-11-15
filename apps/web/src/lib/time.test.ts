import { describe, expect, it } from 'vitest';
import { isDay, isHm } from './time';

describe('URL param guards (audit L3)', () => {
  it('accepts well-formed days and times', () => {
    expect(isDay('2026-11-17')).toBe(true);
    expect(isHm('09:30')).toBe(true);
    expect(isHm('23:59')).toBe(true);
  });
  it('rejects garbage that used to crash the page', () => {
    for (const bad of ['foo', '', null, undefined, '2026-13-01', '2026-11-32', '17/11/2026'])
      expect(isDay(bad)).toBe(false);
    for (const bad of ['9:30', '24:00', '12:60', 'noon', null]) expect(isHm(bad)).toBe(false);
  });
});
