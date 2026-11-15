/**
 * /i/:token — the public invite page (works signed out). Shows the ticket, when + where, who's
 * coming (aliases only), and three actions: Join (sign in, come back, auto-join), Add to calendar,
 * Get me there. Friendly states for full, ended, cancelled, class conflict, and invalid links.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock,
  Check,
  DoorOpen,
  Footprints,
  LinkIcon,
  MapPin,
  Swords,
  UsersRound,
} from 'lucide-react';
import { useEffect } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ApiError } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { Skeleton } from '@/components/EmptyState';
import { Avatars } from '@/components/invites/Avatars';
import { CalendarMenu } from '@/components/invites/CalendarMenu';
import { Ticket } from '@/components/invites/Ticket';
import { Button, buttonVariants } from '@/components/ui/button';
import { useConfig, useFeature } from '@/config';
import { studySession } from '@/lib/calendar';
import { staticMapUrl } from '@/lib/mapStyle';
import { useTheme } from '@/lib/theme';
import { fmtDay, fmtRange, useNow } from '@/lib/time';
import { cn } from '@/lib/utils';

function countdown(start: Date, end: Date, now: Date) {
  if (now >= end) return 'This session has ended';
  if (now >= start) return 'Happening now';
  const mins = Math.round((start.getTime() - now.getTime()) / 60_000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  return `Starts in ${d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m} min`}`;
}

export default function InvitePage() {
  const { token = '' } = useParams();
  const [sp, setSp] = useSearchParams();
  const navigate = useNavigate();
  const { api, status } = useAuth();
  const qc = useQueryClient();
  const config = useConfig();
  const directions = useFeature('directions');
  const dark = useTheme().theme === 'dark';
  const now = useNow();
  const invite = useQuery({
    queryKey: ['invite', token, status],
    queryFn: () => api.invite(token),
    enabled: status !== 'loading',
    retry: false,
  });
  const join = useMutation({
    mutationFn: () => api.joinInvite(token),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invite', token] }),
  });

  const v = invite.data;
  const canJoin = !!v && !v.viewer?.isHost && !v.viewer?.joined;
  // Back from sign-in with ?join=1: join automatically, once.
  useEffect(() => {
    if (sp.get('join') === '1' && status === 'ready' && canJoin && !join.isPending) {
      join.mutate();
      const next = new URLSearchParams(sp);
      next.delete('join');
      setSp(next, { replace: true });
    }
  }, [sp, status, canJoin]); // eslint-disable-line react-hooks/exhaustive-deps

  const onJoin = () => {
    if (status !== 'ready') {
      navigate('/login', { state: { from: { pathname: `/i/${token}`, search: '?join=1' } } });
      return;
    }
    join.mutate();
  };

  const link = `${window.location.origin}/i/${token}`;
  const notFound = invite.error instanceof ApiError && invite.error.status === 404;

  const body = () => {
    const p = v!;
    const start = new Date(p.start);
    const end = new Date(p.end);
    const ended = now >= end;
    const released = p.status === 'RELEASED' || p.status === 'CANCELLED';
    const full = p.attendeeCount + 1 >= p.capacity;
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(start);
    const img = staticMapUrl(config, p.entrance, {
      width: 600,
      height: 260,
      scheme: dark ? 'Dark' : 'Light',
    });
    return (
      <div className="space-y-5">
        <Ticket
          t={{
            roomName: p.roomName,
            buildingName: p.buildingName,
            start: p.start,
            end: p.end,
            hostAlias: p.hostAlias,
            url: link,
          }}
        />

        {released ? (
          <div
            role="status"
            className="rounded-3xl border border-amber/40 bg-amber/10 p-5 text-sm shadow-card"
          >
            <p className="flex items-center gap-2 font-semibold text-amber-ink">
              <Swords className="size-5" aria-hidden />
              {p.releaseReason === 'CLASS_CONFLICT'
                ? 'A class took this room — classes always win.'
                : 'This session was cancelled.'}
            </p>
            {!!p.alternatives?.length && (
              <>
                <p className="mt-2 text-muted">Free rooms for the same time:</p>
                <ul className="mt-2 space-y-2">
                  {p.alternatives.map((a) => (
                    <li key={a.roomId}>
                      <Link
                        to={`/rooms/${encodeURIComponent(a.roomId)}?date=${day}&start=${encodeURIComponent(a.start)}&end=${encodeURIComponent(a.end)}`}
                        className="flex min-h-11 items-center justify-between rounded-xl bg-surface px-3 font-medium hover:bg-cream"
                      >
                        {a.name} · {a.buildingName}
                        <span className="text-muted tabular">seats {a.capacity}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        ) : (
          <section
            aria-label="Who’s going"
            className="space-y-4 rounded-3xl bg-surface p-5 shadow-card"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="inline-flex items-center gap-2 rounded-full bg-cream px-3 py-1.5 text-sm font-semibold tabular">
                <CalendarClock className="size-4 text-brown-ink" aria-hidden />
                {countdown(start, end, now)}
              </p>
              <p className="text-sm text-muted tabular">
                <UsersRound className="mr-1 inline size-4" aria-hidden />
                {p.attendeeCount + 1} of {p.capacity} seats
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Avatars names={[p.hostAlias, ...p.attendees.map((a) => a.alias)]} />
              <p className="text-sm text-muted">
                {p.attendeeCount
                  ? `${p.hostAlias} + ${p.attendeeCount} going`
                  : `${p.hostAlias} is hosting — be the first to join`}
              </p>
            </div>

            {p.viewer?.joined ? (
              <p
                role="status"
                className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-free-50 font-semibold text-free-ink"
              >
                <Check className="size-5" aria-hidden /> You’re in! See it in My Reservations.
              </p>
            ) : p.viewer?.isHost ? (
              <p className="rounded-2xl bg-cream p-3 text-center text-sm text-muted">
                This is your booking — share the link with your group.
              </p>
            ) : (
              <Button
                size="lg"
                className="w-full"
                onClick={onJoin}
                disabled={ended || full || join.isPending}
              >
                {ended ? 'This session has ended' : full ? 'This room is full' : 'Join'}
              </Button>
            )}
            {join.error && (
              <p role="alert" className="text-sm text-amber-ink">
                {join.error instanceof ApiError && join.error.code === 'ROOM_FULL'
                  ? 'Someone grabbed the last seat — this room is full.'
                  : 'Couldn’t join right now. Try again in a moment.'}
              </p>
            )}
            <div className="grid gap-2 sm:grid-cols-2">
              <CalendarMenu
                className="w-full"
                icsHref={api.inviteCalendarUrl(token)}
                event={studySession({
                  roomName: p.roomName,
                  buildingName: p.buildingName,
                  start: p.start,
                  end: p.end,
                  link,
                })}
              />
              {directions && (
                <Link
                  to={`/map?to=${encodeURIComponent(p.roomId)}`}
                  className={cn(buttonVariants({ variant: 'outline' }), 'w-full')}
                >
                  <Footprints className="size-4" aria-hidden /> Get me there
                </Link>
              )}
            </div>
          </section>
        )}

        <figure className="overflow-hidden rounded-3xl bg-surface shadow-card">
          {img ? (
            <img
              src={img}
              alt={`Map: ${p.buildingName} entrance`}
              width={600}
              height={260}
              loading="lazy"
              className="h-48 w-full object-cover md:h-56"
            />
          ) : (
            <div className="grid h-40 place-items-center bg-[radial-gradient(circle_at_50%_60%,var(--color-sand),var(--color-cream))]">
              <MapPin className="size-10 text-brown-ink" aria-hidden />
            </div>
          )}
          <figcaption className="flex items-center gap-2 px-4 py-3 text-sm">
            <DoorOpen className="size-4 shrink-0 text-brown-ink" aria-hidden />
            {p.buildingName} — main entrance · {fmtDay(day)}, {fmtRange(p.start, p.end)}
          </figcaption>
        </figure>

        <p className="text-center text-xs text-muted">
          FreeRoom bookings are informal and student-run — not an official university booking. You
          only ever see aliases here, never names or contact details.
        </p>
      </div>
    );
  };

  return (
    <div className="min-h-dvh bg-cream">
      <header className="bg-brand-gradient px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-40 text-white md:px-10">
        <nav className="flex items-center justify-between" aria-label="Site">
          <Link to="/welcome" className="flex items-center gap-2 text-xl font-bold">
            <DoorOpen className="size-7" aria-hidden /> FreeRoom
          </Link>
          {status !== 'ready' && (
            <Link to="/login" className={buttonVariants({ variant: 'light', size: 'sm' })}>
              Sign in
            </Link>
          )}
        </nav>
        <div className="mx-auto mt-8 max-w-xl text-center">
          <p className="text-sm font-semibold tracking-[0.18em] text-white/85 uppercase">
            You’re invited
          </p>
          <h1 className="mt-2 min-h-10 text-3xl leading-tight font-bold md:text-4xl">
            {v ? `${v.hostAlias} booked a study room` : notFound ? 'This invite has expired' : ''}
          </h1>
        </div>
      </header>

      <main className="mx-auto -mt-32 max-w-xl px-4 pb-16">
        {invite.isLoading || status === 'loading' ? (
          <Skeleton className="mx-auto h-[440px] max-w-sm rounded-3xl" />
        ) : notFound || !v ? (
          <div className="mx-auto max-w-sm rounded-3xl bg-surface p-6 text-center shadow-card">
            <LinkIcon className="mx-auto size-8 text-muted" aria-hidden />
            <h2 className="mt-3 text-xl font-bold">This link isn’t valid anymore</h2>
            <p className="mt-2 text-sm text-muted">
              The host may have made a new one, or the session is over. Ask them for a fresh link —
              or find your own free room in seconds.
            </p>
            <Link to="/" className={cn(buttonVariants({ size: 'lg' }), 'mt-5 w-full')}>
              Find a free room
            </Link>
          </div>
        ) : (
          body()
        )}
      </main>
    </div>
  );
}
