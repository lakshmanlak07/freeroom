import { DEFAULT_ROLE_LIMITS, campusDayStart, overlaps } from '@freeroom/domain';
import type { ReservationItem, RoomStatus } from '@freeroom/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  BookOpen,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Clock,
  DoorClosed,
  List,
  Rows3,
  Star,
  TriangleAlert,
  UserRound,
  Users,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { ApiError } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { ClaimDialog } from '@/components/ClaimDialog';
import { EmptyState, Skeleton } from '@/components/EmptyState';
import { EquipmentList } from '@/components/Equipment';
import { ReserveSheet } from '@/components/ReserveSheet';
import { StatusChip } from '@/components/StatusChip';
import { TextView, Timeline } from '@/components/Timeline';
import type { ScheduleItem } from '@/components/TimelineBlock';
import { Button, inputClass } from '@/components/ui/button';
import { addDays, campusDay, campusLocalToUtc, fmtDay, fmtDuration, useNow } from '@/lib/time';
import { cn } from '@/lib/utils';

const SLOT = 15 * 60_000;
const VIEW_KEY = 'freeroom.timelineView';
const readView = () => {
  try {
    return localStorage.getItem(VIEW_KEY) === 'text' ? 'text' : 'timeline';
  } catch {
    return 'timeline';
  }
};

function liveStatus(
  items: ScheduleItem[],
  now: Date,
  dayEnd: Date,
): { status: RoomStatus; freeUntil: string | null } {
  const at = { start: now, end: new Date(now.getTime() + 1) };
  const iv = (x: ScheduleItem) => ({ start: new Date(x.start), end: new Date(x.end) });
  if (items.some((x) => x.kind === 'class' && overlaps(iv(x), at)))
    return { status: 'CLASS_IN_PROGRESS', freeUntil: null };
  const res = items.find((x) => x.kind === 'reservation' && overlaps(iv(x), at));
  if (res?.kind === 'reservation')
    return { status: res.claimable ? 'RESERVED_CLAIMABLE' : 'RESERVED', freeUntil: null };
  const next = items
    .map((x) => Date.parse(x.start))
    .filter((s) => s > now.getTime())
    .sort((a, b) => a - b)[0];
  return {
    status: 'FREE',
    freeUntil: new Date(Math.min(next ?? Infinity, dayEnd.getTime())).toISOString(),
  };
}

export function RoomPage() {
  const { roomId = '' } = useParams();
  const { api, me } = useAuth();
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const now = useNow(30_000);
  const today = campusDay(now);
  const day = sp.get('date') ?? today;
  const [view, setView] = useState<'timeline' | 'text'>(readView);
  // "Rebook here" (BR-9 alternatives) links here with ?start=&end= to open the sheet prefilled.
  const [range, setRange] = useState<{ start: Date; end: Date } | null>(() => {
    const st = sp.get('start');
    const en = sp.get('end');
    return st && en && !Number.isNaN(Date.parse(st)) && !Number.isNaN(Date.parse(en))
      ? { start: new Date(st), end: new Date(en) }
      : null;
  });
  const [claim, setClaim] = useState<ReservationItem | null>(null);

  const room = useQuery({ queryKey: ['room', roomId], queryFn: () => api.room(roomId) });
  const from = campusDayStart(day);
  const to = campusDayStart(addDays(day, 1));
  const schedule = useQuery({
    queryKey: ['schedule', roomId, day],
    queryFn: () => api.schedule(roomId, from.toISOString(), to.toISOString()),
    refetchInterval: 10_000, // real-time = polling (CLAUDE.md)
  });
  const items = schedule.data?.items ?? [];
  const refetch = () => {
    void qc.invalidateQueries({ queryKey: ['schedule', roomId] });
    void qc.invalidateQueries({ queryKey: ['rooms'] });
    void qc.invalidateQueries({ queryKey: ['myReservations'] });
  };
  const maxMinutes = DEFAULT_ROLE_LIMITS[me?.role ?? 'STUDENT'].maxDurationMinutes;

  const setDay = (d: string) => setSp(d === today ? {} : { date: d }, { replace: true });
  const switchView = (v: 'timeline' | 'text') => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // per-viewer preference only
    }
  };

  /** Keyboard path: first free hour from now (or 07:00) on this day. */
  const reserveNext = () => {
    const dayStart = campusLocalToUtc(`${day}T07:00`).getTime();
    const dayEnd = campusLocalToUtc(`${day}T23:00`).getTime();
    const busy = items.map((x) => [Date.parse(x.start), Date.parse(x.end)] as const);
    for (
      let t = Math.max(dayStart, Math.ceil(now.getTime() / SLOT) * SLOT);
      t < dayEnd;
      t += SLOT
    ) {
      if (busy.some(([s, e]) => s < t + SLOT && t < e)) continue;
      let end = t + SLOT;
      while (
        end < Math.min(dayEnd, t + 4 * SLOT) &&
        !busy.some(([s, e]) => s < end + SLOT && end < e)
      )
        end += SLOT;
      setRange({ start: new Date(t), end: new Date(end) });
      return;
    }
  };

  if (room.error instanceof ApiError && room.error.status === 404) {
    return (
      <div className="p-6">
        <EmptyState
          icon={DoorClosed}
          title="Room not found"
          body="It may have been removed from the 25Live catalog."
          action={
            <Link className="font-semibold text-brown underline" to="/">
              Back to search
            </Link>
          }
        />
      </div>
    );
  }

  const lastSynced = schedule.data?.staleness.lastSyncedAt;
  const staleMin = lastSynced
    ? Math.floor((now.getTime() - Date.parse(lastSynced)) / 60_000)
    : null;

  return (
    <div>
      <section className="bg-brand-gradient px-4 pt-6 pb-12 text-white md:px-8 md:pb-14">
        <Link
          to="/"
          className="inline-flex items-center gap-1 rounded-lg text-sm text-white/90 hover:text-white"
        >
          <ArrowLeft className="size-4" aria-hidden /> All rooms
        </Link>
        {room.data ? (
          <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold md:text-4xl">{room.data.name}</h1>
              <p className="text-white/90">{room.data.buildingName}</p>
            </div>
          </div>
        ) : (
          <Skeleton className="mt-3 h-12 w-64 bg-white/20" />
        )}
      </section>

      <div className="space-y-5 px-4 py-6 md:px-8">
        {room.data && (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-white p-4 shadow-card">
            {day === today && schedule.data && <StatusChip {...liveStatus(items, now, to)} />}
            <span className="inline-flex items-center gap-1 text-sm text-muted tabular">
              <Users className="size-4" aria-hidden /> {room.data.capacity} seats
            </span>
            <EquipmentList items={room.data.equipment} labels />
          </div>
        )}

        {staleMin !== null && staleMin > 30 && (
          <p
            role="status"
            className="flex items-center gap-2 rounded-xl bg-amber/10 px-3 py-2 text-sm text-amber-ink"
          >
            <Clock className="size-4" aria-hidden /> Schedule last updated{' '}
            {fmtDuration(staleMin * 60_000)} ago — the server re-checks classes before booking.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            aria-label="Previous day"
            disabled={day <= today}
            onClick={() => setDay(addDays(day, -1))}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <label className="sr-only" htmlFor="day">
            Date
          </label>
          <input
            id="day"
            type="date"
            className={cn(inputClass, 'w-auto tabular')}
            min={today}
            max={addDays(today, 7)}
            value={day}
            onChange={(e) => e.target.value && setDay(e.target.value)}
          />
          <Button
            variant="outline"
            size="sm"
            aria-label="Next day"
            disabled={day >= addDays(today, 7)}
            onClick={() => setDay(addDays(day, 1))}
          >
            <ChevronRight className="size-4" />
          </Button>
          <span className="ml-1 text-sm font-medium">{fmtDay(day)}</span>
          <div className="flex w-full gap-2 sm:ml-auto sm:w-auto">
            <div
              className="flex flex-1 rounded-xl border border-line bg-white p-0.5 sm:flex-none"
              role="group"
              aria-label="View"
            >
              {(
                [
                  ['timeline', Rows3, 'Timeline'],
                  ['text', List, 'Text view'],
                ] as const
              ).map(([v, Icon, label]) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => switchView(v)}
                  className={cn(
                    'inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium whitespace-nowrap',
                    view === v ? 'bg-brown text-white' : 'text-muted hover:bg-cream',
                  )}
                >
                  <Icon className="size-4" aria-hidden /> {label}
                </button>
              ))}
            </div>
            <Button onClick={reserveNext} disabled={!room.data} className="whitespace-nowrap">
              <CalendarPlus className="size-4" aria-hidden /> Reserve
              <span className="hidden sm:inline"> a time</span>
            </Button>
          </div>
        </div>

        <Legend />

        {schedule.isError ? (
          <EmptyState
            tone="error"
            icon={TriangleAlert}
            title="Couldn’t load the schedule"
            body={schedule.error.message}
            action={<Button onClick={() => void schedule.refetch()}>Try again</Button>}
          />
        ) : schedule.isLoading ? (
          <Skeleton className="h-36" />
        ) : view === 'timeline' ? (
          <>
            <Timeline
              day={day}
              items={items}
              now={now}
              maxMinutes={maxMinutes}
              onSelect={(start, end) => setRange({ start, end })}
              onRequest={setClaim}
            />
            <p className="text-xs text-muted">
              Click or drag on open space to reserve (15-minute steps). Hover or focus a block for
              details.
            </p>
          </>
        ) : (
          <TextView
            day={day}
            items={items}
            now={now}
            onSelect={(start, end) => setRange({ start, end })}
          />
        )}
      </div>

      {room.data && (
        <ReserveSheet
          room={room.data}
          day={day}
          range={range}
          items={items}
          onClose={() => {
            setRange(null);
            if (sp.has('start')) setSp(day === today ? {} : { date: day }, { replace: true });
          }}
          onChanged={refetch}
        />
      )}
      <ClaimDialog
        reservation={claim}
        roomName={room.data?.name ?? ''}
        onClose={() => setClaim(null)}
      />
    </div>
  );
}

/** BR-2: color AND pattern/icon. */
function Legend() {
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted" aria-label="Legend">
      <li className="inline-flex items-center gap-1.5">
        <span className="stripes-class grid size-4 place-items-center rounded bg-plum text-white">
          <BookOpen className="size-2.5" aria-hidden />
        </span>
        Class (25Live)
      </li>
      <li className="inline-flex items-center gap-1.5">
        <span className="grid size-4 place-items-center rounded bg-slate text-white">
          <UserRound className="size-2.5" aria-hidden />
        </span>
        Reservation
      </li>
      <li className="inline-flex items-center gap-1.5">
        <span className="grid size-4 place-items-center rounded bg-slate text-gold outline-2 outline-offset-1 outline-gold">
          <Star className="size-2.5 fill-gold" aria-hidden />
        </span>
        Yours
      </li>
      <li className="inline-flex items-center gap-1.5">
        <span className="size-4 rounded border border-free bg-free-50" aria-hidden />
        Free — click or drag to reserve
      </li>
    </ul>
  );
}
