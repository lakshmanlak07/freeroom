/**
 * The fox's brain, pure so it's unit-testable: a spring that chases a target, and a state
 * machine over (speed, time since the pointer last moved, celebrate window).
 *   CELEBRATE > WANDER (pointer quiet ≥ 8s) > RUN (fast) > HOP (moving) > IDLE (quiet ≥ 2s) > HOP
 * FACE flips with horizontal velocity (with a dead zone so it doesn't jitter).
 */
export type FoxState = 'hop' | 'run' | 'idle' | 'wander' | 'celebrate';

export const IDLE_AFTER_MS = 2_000;
export const WANDER_AFTER_MS = 8_000;
export const RUN_SPEED = 650; // px/s
export const MOVE_SPEED = 12; // px/s; below this the fox is standing
export const FOLLOW_GAP = 40; // px behind the cursor
export const CELEBRATE_MS = 1_800;

export interface FoxInput {
  now: number;
  speed: number;
  lastPointerMove: number;
  celebrateUntil: number;
}

export function nextState(i: FoxInput): FoxState {
  if (i.now < i.celebrateUntil) return 'celebrate';
  const quiet = i.now - i.lastPointerMove;
  if (quiet >= WANDER_AFTER_MS) return 'wander';
  if (i.speed > RUN_SPEED) return 'run';
  if (i.speed > MOVE_SPEED) return 'hop';
  return quiet >= IDLE_AFTER_MS ? 'idle' : 'hop';
}

/** 1 = facing right, -1 = left. Keeps the old facing inside the dead zone. */
export const nextFacing = (prev: 1 | -1, vx: number): 1 | -1 =>
  vx > 25 ? 1 : vx < -25 ? -1 : prev;

/** Where the fox aims: FOLLOW_GAP short of the cursor, along the line from the fox. */
export function followTarget(fox: { x: number; y: number }, cursor: { x: number; y: number }) {
  const dx = cursor.x - fox.x;
  const dy = cursor.y - fox.y;
  const d = Math.hypot(dx, dy);
  if (d <= FOLLOW_GAP) return fox;
  return { x: cursor.x - (dx / d) * FOLLOW_GAP, y: cursor.y - (dy / d) * FOLLOW_GAP };
}

/** One semi-implicit Euler step of a damped spring (slightly under-damped: a playful settle). */
export function springStep(p: number, v: number, target: number, dt: number, k = 90, c = 15) {
  const nv = v + (k * (target - p) - c * v) * dt;
  return [p + nv * dt, nv] as const;
}
