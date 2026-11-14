import * as Dialog from '@radix-ui/react-dialog';
import {
  DEFAULT_ROLE_LIMITS,
  confirmWindowOpensAt,
  cutoffAt,
  overlaps,
  validateReservationRequest,
} from '@freeroom/domain';
import type { Role, Room } from '@freeroom/shared';
import { useMutation } from '@tanstack/react-query';
import { TriangleAlert, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ApiError } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { campusLocalToUtc, fmtDay, fmtRange, fmtTime } from '@/lib/time';
import { useToast } from './Toast';
import type { ScheduleItem } from './TimelineBlock';
import { Button, inputClass } from './ui/button';

const SLOT = 15 * 60_000;
const ROLE_LABEL: Record<Role, string> = {
  STUDENT: 'students',
  FACULTY: 'faculty & staff',
  TUTOR: 'tutors',
  ADMIN: 'admins',
};

const ADVISORY: Record<string, string> = {
  INVALID_SLOT_BOUNDARY: 'Pick a start before the end, on 15-minute marks.',
  IN_PAST: 'That time has already started.',
  BEYOND_HORIZON: 'You can reserve up to 7 days ahead.',
  DURATION_EXCEEDED: 'That’s longer than your role allows.',
};

/** Turn server errors into a friendly sentence (CLASS_CONFLICT / SLOT_TAKEN refetch the timeline). */
function explain(e: unknown): string {
  if (!(e instanceof ApiError)) return 'Something went wrong. Please try again.';
  switch (e.code) {
    case 'CLASS_CONFLICT': {
      const c = (
        e.details?.classes as {
          courseCode?: string;
          name: string;
          eventType?: string;
          start: string;
          end: string;
        }[]
      )?.[0];
      return c
        ? `Overlaps ${c.courseCode ?? c.name}${c.eventType ? ` ${c.eventType}` : ''}, ${fmtRange(c.start, c.end)}. Classes always take priority.`
        : 'A class is scheduled in this room at that time.';
    }
    case 'SLOT_TAKEN':
      return 'Someone just booked this; the timeline was refreshed. Pick another time.';
    case 'QUOTA_EXCEEDED':
      return `You already have the maximum number of active reservations${e.details?.maxActive ? ` (${e.details.maxActive})` : ''}. Cancel one first.`;
    case 'SCHEDULE_UNAVAILABLE':
      return 'The class schedule couldn’t be verified right now, so we can’t safely book. Try again in a minute.';
    default:
      return ADVISORY[e.code] ?? e.message;
  }
}

export function ReserveSheet({
  room,
  day,
  range,
  items,
  onClose,
  onChanged,
}: {
  room: Room;
  day: string;
  range: { start: Date; end: Date } | null;
  items: ScheduleItem[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const { api, me } = useAuth();
  const toast = useToast();
  const role = me?.role ?? 'STUDENT';
  const maxMinutes = DEFAULT_ROLE_LIMITS[role].maxDurationMinutes;
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [partySize, setPartySize] = useState(1);
  const [purpose, setPurpose] = useState('');

  useEffect(() => {
    if (range) {
      setStart(range.start.getTime());
      setEnd(range.end.getTime());
    }
  }, [range]);

  const dayStart = campusLocalToUtc(`${day}T07:00`).getTime();
  const dayEnd = campusLocalToUtc(`${day}T23:00`).getTime();
  const times = useMemo(() => {
    const out: number[] = [];
    for (let t = dayStart; t <= dayEnd; t += SLOT) out.push(t);
    return out;
  }, [dayStart, dayEnd]);

  const now = new Date();
  const iv = { start: new Date(start), end: new Date(end) };
  const classes = items
    .filter((i) => i.kind === 'class')
    .map((c) => ({ ...c, start: new Date(c.start), end: new Date(c.end) }));
  const advisory =
    start && end
      ? validateReservationRequest({ ...iv, roomId: room.roomId }, { role, now, classes })
      : null;
  const takenByReservation = items.some(
    (i) =>
      i.kind === 'reservation' && overlaps({ start: new Date(i.start), end: new Date(i.end) }, iv),
  );
  const pendingNote = start && now < confirmWindowOpensAt(iv.start);

  // New key whenever the request (or the sheet session) changes; retries of the same request
  // reuse it, so a double-submit or network retry can never create two reservations.
  const [session, setSession] = useState(0);
  useEffect(() => setSession((s) => s + 1), [range]);
  const signature = `${session}|${room.roomId}|${start}|${end}|${partySize}|${purpose.trim()}`;
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  useEffect(() => setIdempotencyKey(crypto.randomUUID()), [signature]);

  const reserve = useMutation({
    mutationFn: () =>
      api.createReservation(
        {
          roomId: room.roomId,
          start: iv.start.toISOString(),
          end: iv.end.toISOString(),
          partySize,
          ...(purpose.trim() ? { purpose: purpose.trim() } : {}),
        },
        idempotencyKey,
      ),
    onSuccess: (r) => {
      onChanged();
      toast({
        tone: 'success',
        title: `Reserved ${room.name}`,
        body:
          r.status === 'PENDING_CONFIRMATION'
            ? `${fmtRange(r.start, r.end)}. Confirm between ${fmtTime(confirmWindowOpensAt(new Date(r.start)))} the day before and ${fmtTime(cutoffAt(new Date(r.start)))}.`
            : `${fmtRange(r.start, r.end)} · Confirmed`,
      });
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError && (e.code === 'CLASS_CONFLICT' || e.code === 'SLOT_TAKEN'))
        onChanged();
    },
  });

  const blockingAdvice =
    advisory && !advisory.ok
      ? advisory.code === 'CLASS_CONFLICT'
        ? explain(new ApiError(409, 'CLASS_CONFLICT', '', advisory.details))
        : ADVISORY[advisory.code]
      : takenByReservation
        ? 'That time overlaps an existing reservation.'
        : null;
  const error = reserve.error ? explain(reserve.error) : null;

  return (
    <Dialog.Root open={!!range} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-espresso/30" />
        <Dialog.Content className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-white shadow-2xl">
          <div className="bg-rail px-6 py-5 text-white">
            <div className="flex items-start justify-between">
              <div>
                <Dialog.Title className="text-xl font-semibold">Reserve {room.name}</Dialog.Title>
                <Dialog.Description className="text-sm text-white/90">
                  {room.buildingName} · {fmtDay(day)}
                </Dialog.Description>
              </div>
              <Dialog.Close
                className="rounded-lg p-1 text-white hover:bg-white/15"
                aria-label="Close"
              >
                <X className="size-5" />
              </Dialog.Close>
            </div>
          </div>
          <form
            className="flex flex-1 flex-col gap-4 overflow-y-auto p-6"
            onSubmit={(e) => {
              e.preventDefault();
              reserve.mutate();
            }}
          >
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm font-medium">
                Start
                <select
                  className={`${inputClass} mt-1 tabular`}
                  value={start}
                  onChange={(e) => setStart(Number(e.target.value))}
                >
                  {times.slice(0, -1).map((t) => (
                    <option key={t} value={t} disabled={t < now.getTime()}>
                      {fmtTime(new Date(t))}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-medium">
                End
                <select
                  className={`${inputClass} mt-1 tabular`}
                  value={end}
                  onChange={(e) => setEnd(Number(e.target.value))}
                >
                  {times
                    .filter((t) => t > start && t - start <= maxMinutes * 60_000)
                    .map((t) => (
                      <option key={t} value={t}>
                        {fmtTime(new Date(t))}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            <p className="-mt-2 text-xs text-muted">
              Up to {maxMinutes / 60}h for {ROLE_LABEL[role]}, on 15-minute marks.
            </p>
            <label className="text-sm font-medium">
              Party size
              <input
                type="number"
                min={1}
                max={room.capacity}
                value={partySize}
                onChange={(e) =>
                  setPartySize(Math.max(1, Math.min(room.capacity, Number(e.target.value) || 1)))
                }
                className={`${inputClass} mt-1 tabular`}
              />
              <span className="text-xs font-normal text-muted">Room seats {room.capacity}.</span>
            </label>
            <label className="text-sm font-medium">
              Purpose <span className="font-normal text-muted">(optional)</span>
              <input
                value={purpose}
                maxLength={140}
                onChange={(e) => setPurpose(e.target.value.replace(/[<>]/g, ''))}
                placeholder="Study group for MATH 235"
                className={`${inputClass} mt-1`}
              />
            </label>
            {pendingNote && (
              <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate">
                Booked more than 24h ahead: confirm between 24h and 4h before start, or it’s
                released automatically.
              </p>
            )}
            {(error ?? blockingAdvice) && (
              <p
                role="alert"
                className="flex gap-2 rounded-xl bg-amber/10 px-3 py-2 text-sm text-amber-ink"
              >
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                {error ?? blockingAdvice}
              </p>
            )}
            <div className="mt-auto flex gap-3 pt-2">
              <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                className="flex-1"
                disabled={reserve.isPending || !!blockingAdvice}
              >
                {reserve.isPending ? 'Reserving…' : 'Reserve'}
              </Button>
            </div>
            <p className="text-xs text-muted">
              FreeRoom reservations are informal and student-run — not an official university
              booking.
            </p>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
