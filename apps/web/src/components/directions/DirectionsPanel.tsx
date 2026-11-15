/**
 * "Get me there": walk time, the "free when you arrive?" verdict, one next action, and the steps.
 * Origin = the browser's location (sent once, rounded server-side, never stored) or "I'm at…" a
 * building. Lives in the map's side panel (desktop) / bottom sheet (mobile).
 */
import type { RouteResponse } from '@freeroom/shared';
import { useQuery } from '@tanstack/react-query';
import {
  Accessibility,
  ArrowUp,
  Building2,
  CircleCheck,
  CircleX,
  CornerUpLeft,
  CornerUpRight,
  DoorOpen,
  LocateFixed,
  Search,
  Star,
  TriangleAlert,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ApiError } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { Skeleton } from '@/components/EmptyState';
import { Button, inputClass } from '@/components/ui/button';
import { campusDay, fmtTime } from '@/lib/time';
import { cn } from '@/lib/utils';
import { fmtDistance, fmtWalk, reservePrefill, verdict, type Tone } from './format';

type Origin =
  | { kind: 'locating' }
  | { kind: 'blocked' }
  | { kind: 'geo'; from: string }
  | { kind: 'building'; id: string };

const TONE: Record<Tone, { Icon: LucideIcon; cls: string }> = {
  free: { Icon: CircleCheck, cls: 'bg-free-50 text-free-ink ring-free/40' },
  soon: { Icon: TriangleAlert, cls: 'bg-amber/10 text-amber-ink ring-amber/40' },
  busy: { Icon: CircleX, cls: 'bg-line/70 text-espresso ring-line' },
  mine: { Icon: Star, cls: 'bg-gold/15 text-amber-ink ring-gold/50' },
};

const stepIcon = (s: RouteResponse['steps'][number]): LucideIcon =>
  s.type === 'Arrive'
    ? DoorOpen
    : s.direction === 'left'
      ? CornerUpLeft
      : s.direction === 'right'
        ? CornerUpRight
        : ArrowUp;

export function DirectionsPanel({
  roomId,
  onRoute,
  onClose,
}: {
  roomId: string;
  onRoute: (r: RouteResponse | null) => void;
  onClose: () => void;
}) {
  const { api } = useAuth();
  const navigate = useNavigate();
  const [origin, setOrigin] = useState<Origin>({ kind: 'locating' });
  const [accessible, setAccessible] = useState(false);
  const room = useQuery({ queryKey: ['room', roomId], queryFn: () => api.room(roomId) });
  const buildings = useQuery({ queryKey: ['buildings'], queryFn: api.buildings });

  const locate = () => {
    if (!('geolocation' in navigator)) {
      setOrigin({ kind: 'blocked' });
      return;
    }
    setOrigin({ kind: 'locating' });
    navigator.geolocation.getCurrentPosition(
      ({ coords }) =>
        setOrigin({
          kind: 'geo',
          from: `${coords.latitude.toFixed(6)},${coords.longitude.toFixed(6)}`,
        }),
      () => setOrigin({ kind: 'blocked' }),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  };
  useEffect(locate, []);

  const from =
    origin.kind === 'geo'
      ? origin.from
      : origin.kind === 'building'
        ? `building:${origin.id}`
        : null;
  const route = useQuery({
    queryKey: ['route', roomId, from, accessible],
    queryFn: () => api.route(roomId, from!, accessible),
    enabled: !!from,
    staleTime: 60_000,
    retry: false,
  });
  useEffect(() => {
    onRoute(route.data ?? null);
  }, [route.data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onRoute(null), []); // eslint-disable-line react-hooks/exhaustive-deps

  const r = route.data;
  const v = r && verdict(r.arrival);
  const prefill = r && reservePrefill(r);
  const err = route.error instanceof ApiError ? route.error : null;

  const controls = (
    <div className="space-y-2 rounded-2xl border border-line bg-surface p-3">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant={origin.kind === 'geo' || origin.kind === 'locating' ? 'default' : 'outline'}
          size="sm"
          onClick={locate}
          aria-pressed={origin.kind === 'geo'}
        >
          <LocateFixed className="size-4" aria-hidden /> Use my location
        </Button>
        <button
          type="button"
          role="switch"
          aria-checked={accessible}
          onClick={() => setAccessible((a) => !a)}
          className={cn(
            'ml-auto inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm font-medium md:min-h-8',
            accessible ? 'border-slate bg-slate-50 text-slate' : 'border-line text-muted',
          )}
        >
          <Accessibility className="size-4" aria-hidden /> Accessible route
        </button>
      </div>
      <div className="flex items-center gap-2">
        <Building2 className="size-4 shrink-0 text-muted" aria-hidden />
        <label htmlFor="dir-from" className="sr-only">
          I’m at…
        </label>
        <select
          id="dir-from"
          className={cn(inputClass, 'flex-1')}
          value={origin.kind === 'building' ? origin.id : ''}
          onChange={(e) => e.target.value && setOrigin({ kind: 'building', id: e.target.value })}
        >
          <option value="">I’m at… (pick a building)</option>
          {buildings.data?.buildings.map((b) => (
            <option key={b.buildingId} value={b.buildingId}>
              {b.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );

  return (
    <section aria-labelledby="dir-title" className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-wide text-brown-ink uppercase">
            Get me there
          </p>
          <h2 id="dir-title" className="truncate text-xl font-bold">
            {room.data?.name ?? roomId}
          </h2>
          <p className="truncate text-sm text-muted">{room.data?.buildingName}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close directions"
          className="grid size-11 shrink-0 place-items-center rounded-xl text-muted hover:bg-cream md:size-9"
        >
          <X className="size-5" aria-hidden />
        </button>
      </div>

      {origin.kind === 'blocked' && (
        <div role="status" className="rounded-2xl border border-amber/40 bg-amber/10 p-4 text-sm">
          <p className="font-semibold text-amber-ink">Location is off — no problem.</p>
          <p className="mt-1 text-muted">
            Tell us where you are and we’ll route from its main door.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {buildings.data?.buildings.slice(0, 3).map((b) => (
              <Button
                key={b.buildingId}
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setOrigin({ kind: 'building', id: b.buildingId })}
              >
                I’m at {b.name.replace(/^W\.E\.B\. /, '')}
              </Button>
            ))}
          </div>
        </div>
      )}

      {(origin.kind === 'locating' || route.isLoading) && (
        <div aria-busy="true" aria-label="Finding the best walk" className="space-y-3">
          <Skeleton className="h-16 w-40" />
          <Skeleton className="h-12" />
          <Skeleton className="h-11" />
          <Skeleton className="h-28" />
        </div>
      )}

      {err && (
        <div role="alert" className="rounded-2xl border border-line bg-surface p-4 text-sm">
          <p className="font-semibold">
            {err.code === 'RATE_LIMITED'
              ? 'Easy there — try again in a minute.'
              : 'Couldn’t get directions — try “I’m at…” instead.'}
          </p>
          <p className="mt-1 text-muted">Pick a building below and we’ll route from there.</p>
        </div>
      )}

      {!r && controls}

      {r && v && (
        <div className="space-y-4">
          <div aria-live="polite">
            <p className="flex items-baseline gap-2">
              <span className="text-[48px] leading-none font-bold tabular md:text-[56px]">
                {Math.max(1, Math.round(r.durationSeconds / 60))}
              </span>
              <span className="text-xl font-semibold" aria-hidden>
                min walk
              </span>
              <span className="sr-only">{fmtWalk(r.durationSeconds)}.</span>
            </p>
            <p className="mt-1 text-sm text-muted tabular">
              {fmtDistance(r.distanceMeters)} · arrive {fmtTime(new Date(r.arriveAt))}
            </p>
            <Verdict tone={v.tone} text={v.text} />
          </div>

          {prefill ? (
            <Button
              size="lg"
              className="w-full"
              onClick={() =>
                navigate(
                  `/rooms/${encodeURIComponent(roomId)}?date=${campusDay(prefill.start)}&start=${encodeURIComponent(prefill.start.toISOString())}&end=${encodeURIComponent(prefill.end.toISOString())}`,
                )
              }
            >
              Reserve it for when I arrive
            </Button>
          ) : r.arrival.kind === 'YOURS' ? (
            <Link
              to="/me"
              className="flex min-h-12 w-full items-center justify-center rounded-xl bg-brown px-6 font-semibold text-white"
            >
              It’s booked — see my reservation
            </Link>
          ) : (
            <Button size="lg" className="w-full" onClick={() => navigate('/?freeNow=1')}>
              <Search className="size-4" aria-hidden /> Find a room closer to me
            </Button>
          )}

          {controls}

          <p className="flex items-start gap-2 text-sm text-muted">
            <DoorOpen className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              Heading to{' '}
              <span className="font-medium text-espresso">{r.destinationEntrance.label}</span>
              {accessible && !r.accessibleRouting
                ? '. Step-free paths aren’t available from our map provider yet, so watch for stairs on the way.'
                : '.'}
            </span>
          </p>

          <details className="group rounded-2xl border border-line bg-surface" open>
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-4 text-sm font-semibold">
              Step by step ({r.steps.length})
              <span className="text-muted transition group-open:rotate-180" aria-hidden>
                ▾
              </span>
            </summary>
            <ol className="divide-y divide-line border-t border-line">
              {r.steps.map((s, i) => {
                const Icon = stepIcon(s);
                return (
                  <li key={i} className="flex items-center gap-3 px-4 py-3 text-sm">
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-cream text-brown-ink">
                      <Icon className="size-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">{s.instruction}</span>
                    {s.distanceMeters > 0 && (
                      <span className="shrink-0 text-muted tabular">
                        {fmtDistance(s.distanceMeters)}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </details>
        </div>
      )}
    </section>
  );
}

function Verdict({ tone, text }: { tone: Tone; text: string }) {
  const { Icon, cls } = TONE[tone];
  return (
    <p
      className={cn(
        'mt-3 flex items-center gap-2 rounded-2xl px-4 py-3 text-base font-semibold ring-1',
        cls,
      )}
      data-testid="arrival-verdict"
    >
      <Icon className="size-5 shrink-0" aria-hidden /> {text}
    </p>
  );
}
