import { describe, expect, it } from 'vitest';
import {
  FOLLOW_GAP,
  IDLE_AFTER_MS,
  WANDER_AFTER_MS,
  followTarget,
  nextFacing,
  nextState,
  springStep,
} from './machine';

const at = (o: Partial<Parameters<typeof nextState>[0]>) =>
  nextState({ now: 10_000, speed: 0, lastPointerMove: 10_000, celebrateUntil: 0, ...o });

describe('fox state machine', () => {
  it('hops while moving, runs when fast', () => {
    expect(at({ speed: 100 })).toBe('hop');
    expect(at({ speed: 900 })).toBe('run');
  });
  it('stands (hop pose) briefly, then idles after 2s of a still pointer', () => {
    expect(at({ lastPointerMove: 10_000 - IDLE_AFTER_MS + 1 })).toBe('hop');
    expect(at({ lastPointerMove: 10_000 - IDLE_AFTER_MS })).toBe('idle');
  });
  it('wanders after 8s, even while walking its wander path', () => {
    expect(at({ lastPointerMove: 10_000 - WANDER_AFTER_MS })).toBe('wander');
    expect(at({ lastPointerMove: 10_000 - WANDER_AFTER_MS, speed: 200 })).toBe('wander');
  });
  it('celebrate beats everything until it expires', () => {
    expect(at({ celebrateUntil: 10_001, speed: 900 })).toBe('celebrate');
    expect(at({ celebrateUntil: 10_000 })).toBe('hop');
  });
  it('faces the way it moves, with a dead zone', () => {
    expect(nextFacing(1, -100)).toBe(-1);
    expect(nextFacing(-1, 100)).toBe(1);
    expect(nextFacing(-1, 10)).toBe(-1);
  });
});

describe('fox physics', () => {
  it('aims FOLLOW_GAP short of the cursor, and stays put inside the gap', () => {
    const t = followTarget({ x: 0, y: 0 }, { x: 100, y: 0 });
    expect(t).toEqual({ x: 100 - FOLLOW_GAP, y: 0 });
    expect(followTarget({ x: 0, y: 0 }, { x: 10, y: 10 })).toEqual({ x: 0, y: 0 });
  });
  it('the spring settles on its target', () => {
    let p = 0;
    let v = 0;
    for (let i = 0; i < 300; i++) [p, v] = springStep(p, v, 100, 1 / 60);
    expect(p).toBeCloseTo(100, 0);
    expect(Math.abs(v)).toBeLessThan(1);
  });
});
