/**
 * Horizontal day timeline (07:00–23:00 campus time). Classes and reservations are focusable
 * blocks (arrow keys move between them); free space is click/drag-selectable in 15-min steps.
 * Classes, reservations and the past are never selectable (advisory — the server enforces BR-1/8).
 */
import type { ReservationItem } from '@freeroom/shared';
import { CalendarPlus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { campusLocalToUtc, fmtRange, fmtTime } from '@/lib/time';
import { cn } from '@/lib/utils';
import { TimelineBlock, describe, type ScheduleItem } from './TimelineBlock';
import { Button } from './ui/button';

const SLOT = 15 * 60_000;
const FIRST_HOUR = 7;
const LAST_HOUR = 23;

export function useDayGrid(day: string) {
  return useMemo(() => {
    const start = campusLocalToUtc(`${day}T${String(FIRST_HOUR).padStart(2, '0')}:00`);
    const end = campusLocalToUtc(`${day}T${LAST_HOUR}:00`);
    return { start, end, slots: Math.round((end.getTime() - start.getTime()) / SLOT) };
  }, [day]);
}

interface Props {
  day: string;
  items: ScheduleItem[];
  now: Date;
  maxMinutes: number;
  onSelect: (start: Date, end: Date) => void;
  onRequest: (item: ReservationItem) => void;
}

export function Timeline({ day, items, now, maxMinutes, onSelect, onRequest }: Props) {
  const grid = useDayGrid(day);
  const trackRef = useRef<HTMLDivElement>(null);
  const blockRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [active, setActive] = useState(0);
  const [drag, setDrag] = useState<{ a: number; b: number; moved: boolean } | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  const total = grid.end.getTime() - grid.start.getTime();
  const pct = (t: number) => Math.max(0, Math.min(100, ((t - grid.start.getTime()) / total) * 100));
  const slotStart = (i: number) => grid.start.getTime() + i * SLOT;
  const busy = items.map((x) => [Date.parse(x.start), Date.parse(x.end)] as const);
  const blocked = (i: number) =>
    i < 0 ||
    i >= grid.slots ||
    slotStart(i) < now.getTime() ||
    busy.some(([s, e]) => s < slotStart(i) + SLOT && slotStart(i) < e);
  const maxSlots = Math.floor(maxMinutes / 15);

  const slotAt = (clientX: number) => {
    const r = trackRef.current!.getBoundingClientRect();
    return Math.max(
      0,
      Math.min(grid.slots - 1, Math.floor(((clientX - r.left) / r.width) * grid.slots)),
    );
  };
  /** Contiguous free range from anchor toward target, capped by the role's max duration. */
  const extend = (a: number, b: number) => {
    const dir = b >= a ? 1 : -1;
    let end = a;
    while (end !== b && !blocked(end + dir) && Math.abs(end + dir - a) < maxSlots) end += dir;
    return [Math.min(a, end), Math.max(a, end)] as const;
  };

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    const s = slotAt(e.clientX);
    if (blocked(s)) return;
    trackRef.current!.setPointerCapture(e.pointerId);
    setDrag({ a: s, b: s, moved: false });
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const s = slotAt(e.clientX);
    if (drag) setDrag({ ...drag, b: s, moved: drag.moved || s !== drag.a });
    else setHover(blocked(s) ? null : s);
  };
  const onUp = () => {
    if (!drag) return;
    const [lo, hi] = drag.moved ? extend(drag.a, drag.b) : extend(drag.a, drag.a + 3); // click = up to 1h
    setDrag(null);
    onSelect(new Date(slotStart(lo)), new Date(slotStart(hi + 1)));
  };

  // On narrow screens the track scrolls: start with "now" near the left edge.
  const scrollRef = useRef<HTMLDivElement>(null);
  const nowKey = now >= grid.start && now <= grid.end ? day : null;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !nowKey || el.scrollWidth <= el.clientWidth) return;
    el.scrollLeft = (el.scrollWidth * pct(Date.now())) / 100 - el.clientWidth * 0.15;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowKey]);

  const sel = drag && (drag.moved ? extend(drag.a, drag.b) : ([drag.a, drag.a] as const));
  const nowPct = now >= grid.start && now <= grid.end ? pct(now.getTime()) : null;
  const pastPct = now <= grid.start ? 0 : now >= grid.end ? 100 : (nowPct ?? 0);

  const onBlockKey = (i: number) => (e: KeyboardEvent<HTMLButtonElement>) => {
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: items.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const j = Math.max(0, Math.min(items.length - 1, next));
    setActive(j);
    blockRefs.current[j]?.focus();
  };

  return (
    <div
      ref={scrollRef}
      className="overflow-x-auto rounded-2xl border border-line bg-white shadow-card"
    >
      <div className="relative min-w-[900px] px-4 pt-2 pb-7">
        {/* hour labels */}
        <div className="relative h-6 text-[11px] text-muted tabular" aria-hidden>
          {Array.from({ length: LAST_HOUR - FIRST_HOUR + 1 }, (_, k) => {
            const t = campusLocalToUtc(
              `${day}T${String(FIRST_HOUR + k).padStart(2, '0')}:00`,
            ).getTime();
            return (
              <span
                key={k}
                className={cn(
                  'absolute whitespace-nowrap',
                  k === 0
                    ? ''
                    : k === LAST_HOUR - FIRST_HOUR
                      ? '-translate-x-full'
                      : '-translate-x-1/2',
                )}
                style={{ left: `${pct(t)}%` }}
              >
                {fmtTime(new Date(t)).replace(':00', '')}
              </span>
            );
          })}
        </div>
        <div
          ref={trackRef}
          role="group"
          aria-label="Day timeline"
          aria-describedby="timeline-help"
          className="relative h-24 touch-none select-none rounded-xl bg-free-50/60"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerLeave={() => setHover(null)}
          onPointerCancel={() => setDrag(null)}
        >
          {/* hour gridlines */}
          {Array.from({ length: LAST_HOUR - FIRST_HOUR + 1 }, (_, k) => {
            const t = campusLocalToUtc(
              `${day}T${String(FIRST_HOUR + k).padStart(2, '0')}:00`,
            ).getTime();
            return (
              <div
                key={k}
                className="absolute inset-y-0 w-px bg-line"
                style={{ left: `${pct(t)}%` }}
                aria-hidden
              />
            );
          })}
          {/* past */}
          {pastPct > 0 && (
            <div
              className="absolute inset-y-0 left-0 rounded-l-xl bg-[repeating-linear-gradient(135deg,#e8ddd2_0_2px,transparent_2px_8px)] bg-cream/80"
              style={{ width: `${pastPct}%` }}
              aria-hidden
            />
          )}
          {/* hover affordance */}
          {hover !== null && !drag && (
            <div
              className="pointer-events-none absolute top-3 bottom-3 grid place-items-center rounded-lg border-2 border-dashed border-free bg-white/70 text-[11px] font-semibold text-free-ink"
              style={{ left: `${pct(slotStart(hover))}%`, width: `${(100 / grid.slots) * 4}%` }}
              aria-hidden
            >
              + Reserve
            </div>
          )}
          {items.map((item, i) => (
            <TimelineBlock
              key={item.kind === 'class' ? item.eventId : item.id}
              ref={(el) => {
                blockRefs.current[i] = el;
              }}
              item={item}
              left={pct(Date.parse(item.start))}
              width={pct(Date.parse(item.end)) - pct(Date.parse(item.start))}
              now={now}
              tabIndex={i === active ? 0 : -1}
              onFocusBlock={() => setActive(i)}
              onKeyDown={onBlockKey(i)}
              onRequest={onRequest}
            />
          ))}
          {sel && (
            <div
              className="pointer-events-none absolute top-1.5 bottom-1.5 rounded-lg border-2 border-free bg-free/20"
              style={{
                left: `${pct(slotStart(sel[0]))}%`,
                width: `${pct(slotStart(sel[1] + 1)) - pct(slotStart(sel[0]))}%`,
              }}
            >
              <span className="absolute -top-6 left-0 rounded-md bg-free-ink px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap text-white tabular">
                {fmtRange(new Date(slotStart(sel[0])), new Date(slotStart(sel[1] + 1)))}
              </span>
            </div>
          )}
          {nowPct !== null && (
            <div
              className="pointer-events-none absolute -top-1 -bottom-1 w-0.5 bg-amber"
              style={{ left: `${nowPct}%` }}
              aria-hidden
            >
              <span className="absolute -bottom-4 -translate-x-1/2 rounded bg-amber-ink px-1 text-[10px] font-bold text-white">
                NOW
              </span>
            </div>
          )}
        </div>
        <p id="timeline-help" className="sr-only">
          Use the left and right arrow keys to move between classes and reservations. To book with
          the keyboard, use the Reserve a time button or the Text view.
        </p>
        {!items.length && (
          <p className="mt-3 text-center text-sm text-muted">
            Nothing scheduled — the whole day is open.
          </p>
        )}
      </div>
    </div>
  );
}

/** Accessible alternative to the visual timeline: every booking and every free gap as a list. */
export function TextView({ day, items, now, onSelect }: Omit<Props, 'onRequest' | 'maxMinutes'>) {
  const grid = useDayGrid(day);
  const from = Math.max(grid.start.getTime(), Math.ceil(now.getTime() / SLOT) * SLOT);
  const entries: { start: number; end: number; item?: ScheduleItem }[] = items.map((item) => ({
    start: Date.parse(item.start),
    end: Date.parse(item.end),
    item,
  }));
  let cursor = from;
  for (const e of [...entries].sort((a, b) => a.start - b.start)) {
    if (e.start - cursor >= SLOT) entries.push({ start: cursor, end: e.start });
    cursor = Math.max(cursor, e.end);
  }
  if (grid.end.getTime() - cursor >= SLOT) entries.push({ start: cursor, end: grid.end.getTime() });
  entries.sort((a, b) => a.start - b.start);

  return (
    <ol
      className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white shadow-card"
      aria-label="Schedule (text view)"
    >
      {entries.map((e) => (
        <li key={`${e.start}-${e.item ? 'b' : 'f'}`} className="flex items-center gap-3 px-4 py-3">
          <span className="w-40 shrink-0 text-sm font-semibold tabular">
            {fmtRange(new Date(e.start), new Date(e.end))}
          </span>
          {e.item ? (
            <span
              className={cn(
                'min-w-0 flex-1 text-sm',
                e.item.kind === 'class' ? 'text-plum' : 'text-slate',
              )}
            >
              {describe(e.item)}
            </span>
          ) : (
            <>
              <span className="flex-1 text-sm font-medium text-free-ink">Free</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  onSelect(new Date(e.start), new Date(Math.min(e.end, e.start + 4 * SLOT)))
                }
              >
                <CalendarPlus className="size-4" aria-hidden /> Reserve
              </Button>
            </>
          )}
        </li>
      ))}
    </ol>
  );
}
