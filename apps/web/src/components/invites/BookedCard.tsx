/**
 * The moment after "Reserve": a celebratory card (fox celebrates, a short confetti burst that is
 * skipped under reduced motion) with three big next steps — Invite, Calendar, Get me there.
 */
import * as Dialog from '@radix-ui/react-dialog';
import type { ReservationDetail } from '@freeroom/shared';
import { CircleCheck, Footprints, UsersRound } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { useToast } from '@/components/Toast';
import { Button, buttonVariants } from '@/components/ui/button';
import { useFeature } from '@/config';
import { studySession } from '@/lib/calendar';
import { fmtDay, fmtRange } from '@/lib/time';
import { cn } from '@/lib/utils';
import { CalendarMenu } from './CalendarMenu';

const InviteSheet = lazy(() => import('./InviteSheet'));

const COLORS = ['#e8b931', '#ffffff', '#4cc38a', '#6fa8e8', '#b48ce0', '#f07c1f'];

export function Confetti() {
  return (
    <div aria-hidden className="confetti pointer-events-none absolute inset-x-0 top-0 h-0">
      {Array.from({ length: 22 }, (_, i) => (
        <span
          key={i}
          style={{
            left: `${8 + ((i * 41) % 84)}%`,
            background: COLORS[i % COLORS.length],
            ['--dx' as string]: `${((i * 37) % 120) - 60}px`,
            ['--dy' as string]: `${110 + ((i * 53) % 120)}px`,
            ['--r' as string]: `${(i * 67) % 360}deg`,
            animationDelay: `${(i % 6) * 25}ms`,
          }}
        />
      ))}
    </div>
  );
}

export function BookedCard({
  r,
  room,
  onDone,
}: {
  r: ReservationDetail;
  room: { roomId: string; name: string; buildingName: string };
  onDone: () => void;
}) {
  const { api, me } = useAuth();
  const toast = useToast();
  const invites = useFeature('invites');
  const directions = useFeature('directions');
  const [inviting, setInviting] = useState(false);
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(
    new Date(r.start),
  );
  const big = 'h-auto min-h-14 w-full justify-start gap-3 rounded-2xl px-4 py-3 text-base';

  return (
    <div className="relative flex flex-1 flex-col">
      <div className="relative overflow-hidden bg-rail px-6 pt-6 pb-8 text-white">
        <Confetti />
        <CircleCheck className="size-9" aria-hidden />
        <Dialog.Title className="mt-2 text-2xl font-bold">You’re booked!</Dialog.Title>
        <Dialog.Description className="text-white/90">
          {room.name} · {fmtDay(day)}
        </Dialog.Description>
        <p className="mt-2 text-[40px] leading-none font-bold tabular">
          {fmtRange(r.start, r.end)}
        </p>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-6">
        {r.status === 'PENDING_CONFIRMATION' && (
          <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate">
            Confirm it between 24 and 4 hours before it starts — it’s in My Reservations.
          </p>
        )}
        {invites && (
          <Button size="lg" className={big} onClick={() => setInviting(true)}>
            <UsersRound className="size-5" aria-hidden /> Invite your group
          </Button>
        )}
        <CalendarMenu
          size="lg"
          className={big}
          event={studySession({
            roomName: room.name,
            buildingName: room.buildingName,
            start: r.start,
            end: r.end,
            link: `${window.location.origin}/rooms/${encodeURIComponent(room.roomId)}`,
          })}
          onIcs={() => {
            api
              .downloadCalendar(r.id, `freeroom-${room.name.replace(/[^A-Za-z0-9]+/g, '-')}.ics`)
              .catch(() =>
                toast({ tone: 'error', title: 'Couldn’t make the calendar file', body: '' }),
              );
          }}
        />
        {directions && (
          <Link
            to={`/map?to=${encodeURIComponent(room.roomId)}`}
            className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), big)}
          >
            <Footprints className="size-5" aria-hidden /> Get me there
          </Link>
        )}
        <Button variant="ghost" className="mt-auto" onClick={onDone}>
          Done
        </Button>
      </div>
      {inviting && (
        <Suspense fallback={null}>
          <InviteSheet
            target={{
              reservationId: r.id,
              roomId: room.roomId,
              start: r.start,
              end: r.end,
              hostAlias: me?.displayAlias ?? r.ownerAlias,
            }}
            onClose={() => setInviting(false)}
          />
        </Suspense>
      )}
    </div>
  );
}
