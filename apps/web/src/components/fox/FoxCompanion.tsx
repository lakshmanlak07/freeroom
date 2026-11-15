/**
 * The fox that keeps you company. One requestAnimationFrame loop writes translate3d through refs
 * (no React re-render per frame), pauses while the tab is hidden, and never takes input:
 * pointer-events none + aria-hidden. Mouse: chases the cursor on a spring, FOLLOW_GAP behind.
 * Touch: sits bottom-right and hops to taps. Reduced motion: a static fox. On by default with a
 * mouse, off by default on touch; the choice is remembered.
 */
import { PawPrint } from 'lucide-react';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { cn } from '@/lib/utils';
import { FoxSprite } from './FoxSprite';
import {
  CELEBRATE_MS,
  followTarget,
  nextFacing,
  nextState,
  springStep,
  type FoxState,
} from './machine';

const KEY = 'freeroom.fox';
const PREF_EVENT = 'freeroom:fox';
const CELEBRATE_EVENT = 'freeroom:celebrate';
const SIZE = 56;
const TAP_STAY_MS = 3_000;

const coarse = () => window.matchMedia('(pointer: coarse)').matches;
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let override: boolean | null = null; // holds the choice when storage is blocked
function readEnabled() {
  if (override !== null) return override;
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'on' || v === 'off') return v === 'on';
  } catch {
    // storage blocked: fall through to the default
  }
  return !coarse();
}
function setEnabled(on: boolean) {
  override = on;
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    // storage blocked: remembered for this page view only
  }
  window.dispatchEvent(new Event(PREF_EVENT));
}
const subscribe = (cb: () => void) => {
  window.addEventListener(PREF_EVENT, cb);
  return () => window.removeEventListener(PREF_EVENT, cb);
};
const useFoxEnabled = () => useSyncExternalStore(subscribe, readEnabled);

/** Call on a happy moment (a reservation went through). */
export const celebrate = () => window.dispatchEvent(new Event(CELEBRATE_EVENT));

export function FoxToggle({ onRail = false }: { onRail?: boolean }) {
  const on = useFoxEnabled();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => setEnabled(!on)}
      className={cn(
        'flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-sm md:min-h-9',
        onRail ? 'text-white/85 hover:bg-white/10' : 'text-espresso hover:bg-cream',
      )}
    >
      <PawPrint className="size-4" aria-hidden />
      Fox companion
      <span
        aria-hidden
        className={cn(
          'ml-auto flex h-5 w-9 items-center rounded-full p-0.5 transition-colors',
          on ? 'justify-end bg-gold' : onRail ? 'bg-white/25' : 'bg-line',
        )}
      >
        <span className="size-4 rounded-full bg-white shadow" />
      </span>
    </button>
  );
}

export function FoxCompanion() {
  const enabled = useFoxEnabled();
  const root = useRef<HTMLDivElement>(null);
  const flip = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!enabled) return;
    const el = root.current!;
    const flipEl = flip.current!;
    const touch = coarse();
    const home = () => ({
      x: window.innerWidth - SIZE - 12,
      // above the phone tab bar (and its safe-area inset); bottom corner on desktop
      y: window.innerHeight - SIZE - (window.innerWidth < 768 ? 84 : 12),
    });
    const pos = home();
    const vel = { x: 0, y: 0 };
    let facing: 1 | -1 = -1;
    let state: FoxState = 'idle';
    let cursor: { x: number; y: number } | null = null;
    let tap: { x: number; y: number; until: number } | null = null;
    let wander: { x: number; y: number; until: number } | null = null;
    let lastMove = performance.now();
    let celebrateUntil = 0;

    const paint = () => {
      el.style.transform = `translate3d(${pos.x.toFixed(1)}px, ${pos.y.toFixed(1)}px, 0)`;
      flipEl.style.transform = `scaleX(${facing})`;
      el.dataset.state = state;
    };
    const onCelebrate = () => {
      celebrateUntil = performance.now() + CELEBRATE_MS;
      if (reducedMotion()) {
        state = 'celebrate';
        paint();
        setTimeout(() => {
          state = 'idle';
          paint();
        }, CELEBRATE_MS);
      }
    };
    window.addEventListener(CELEBRATE_EVENT, onCelebrate);

    if (reducedMotion()) {
      paint(); // static fox in its corner
      return () => window.removeEventListener(CELEBRATE_EVENT, onCelebrate);
    }

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      cursor = { x: e.clientX - SIZE / 2, y: e.clientY - SIZE / 2 };
      lastMove = performance.now();
    };
    const onTap = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return;
      tap = {
        x: e.clientX - SIZE / 2,
        y: e.clientY - SIZE,
        until: performance.now() + TAP_STAY_MS,
      };
      lastMove = performance.now();
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onTap, { passive: true });

    let raf = 0;
    let last = performance.now();
    const clampX = (x: number) => Math.max(8, Math.min(window.innerWidth - SIZE - 8, x));
    const clampY = (y: number) => Math.max(8, Math.min(window.innerHeight - SIZE - 8, y));
    const frame = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      let goal: { x: number; y: number };
      if (touch || !cursor) {
        goal = tap && t < tap.until ? tap : home();
      } else if (state === 'wander') {
        if (!wander || t > wander.until) {
          wander = {
            x: clampX(pos.x + (Math.random() - 0.5) * 320),
            y: clampY(pos.y + (Math.random() - 0.5) * 200),
            until: t + 2_500,
          };
        }
        goal = wander;
      } else {
        wander = null;
        goal = followTarget(pos, cursor);
      }
      [pos.x, vel.x] = springStep(pos.x, vel.x, goal.x, dt);
      [pos.y, vel.y] = springStep(pos.y, vel.y, goal.y, dt);
      const s = nextState({
        now: t,
        speed: Math.hypot(vel.x, vel.y),
        lastPointerMove: lastMove,
        celebrateUntil,
      });
      state = touch && s === 'wander' ? 'idle' : s; // on phones it rests in its corner
      facing = nextFacing(facing, vel.x);
      paint();
      raf = requestAnimationFrame(frame);
    };
    const start = () => {
      cancelAnimationFrame(raf);
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };
    const onVisibility = () => (document.hidden ? cancelAnimationFrame(raf) : start());
    document.addEventListener('visibilitychange', onVisibility);
    paint();
    if (!document.hidden) start();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener(CELEBRATE_EVENT, onCelebrate);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onTap);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled]);

  if (!enabled) return null;
  return (
    <div
      ref={root}
      aria-hidden="true"
      data-testid="fox-companion"
      className="fox pointer-events-none fixed top-0 left-0 z-[60] will-change-transform dark:drop-shadow-[0_3px_6px_rgb(0_0_0/0.7)]"
    >
      <div ref={flip}>
        <FoxSprite size={SIZE} />
      </div>
    </div>
  );
}
