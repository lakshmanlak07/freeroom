/** Demo Controls (admin + demoMode only): the on-stage buttons for BR-9 and BR-6, with a live log. */
import type { ReservationItem } from '@freeroom/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FastForward, FlaskConical, RotateCcw, Zap } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { EmptyState } from '@/components/EmptyState';
import { Button, inputClass } from '@/components/ui/button';
import { useConfig } from '@/config';
import { addDays, campusDay, campusLocalToUtc, fmtRange, fmtTime } from '@/lib/time';
import { cn } from '@/lib/utils';

export function DemoPage() {
  const { api, me } = useAuth();
  const config = useConfig();
  const qc = useQueryClient();
  const today = campusDay(new Date());
  const [roomId, setRoomId] = useState('');
  const [day, setDay] = useState(today);
  const [picked, setPicked] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [log, setLog] = useState<{ at: Date; text: string; ok: boolean }[]>([]);
  const rooms = useQuery({ queryKey: ['rooms', {}], queryFn: () => api.rooms({}) });
  const schedule = useQuery({
    queryKey: ['schedule', roomId, day],
    queryFn: () =>
      api.schedule(
        roomId,
        campusLocalToUtc(`${day}T00:00`).toISOString(),
        campusLocalToUtc(`${addDays(day, 1)}T00:00`).toISOString(),
      ),
    enabled: !!roomId,
    refetchInterval: 10_000,
  });
  const reservations = (schedule.data?.items ?? []).filter(
    (i): i is ReservationItem => i.kind === 'reservation',
  );

  const run = useMutation({
    mutationFn: async (what: 'conflict' | 'forward' | 'reset') =>
      what === 'conflict'
        ? api.demo.injectConflict(picked!)
        : what === 'forward'
          ? api.demo.fastForward(picked!)
          : api.demo.reset(),
    onSuccess: (r, what) => {
      const text =
        what === 'conflict'
          ? `Injected a class over the reservation → ${String(r.status ?? 'done')}${r.releaseReason ? ` (${String(r.releaseReason)})` : ''}. Owner notified with 3 alternatives.`
          : what === 'forward'
            ? `Fast-forwarded to cutoff → released ${String(r.released ?? 0)}, expired ${String(r.expired ?? 0)} claim(s).`
            : `Reset: deleted ${String(r.deleted ?? 0)} items and resynced the schedule.`;
      setLog((l) => [{ at: new Date(), text, ok: true }, ...l]);
      setPicked(null);
      setConfirmReset(false);
      void qc.invalidateQueries();
    },
    onError: (e) =>
      setLog((l) => [
        { at: new Date(), text: e instanceof Error ? e.message : 'Failed', ok: false },
        ...l,
      ]),
  });

  if (me?.role !== 'ADMIN' || !config.demoMode) {
    return (
      <div className="p-6">
        <EmptyState
          icon={FlaskConical}
          title="Demo controls are admin-only"
          body="They’re also switched off outside demo mode."
        />
      </div>
    );
  }
  return (
    <div>
      <section className="bg-brand-gradient px-4 pt-8 pb-14 text-white md:px-8">
        <h1 className="text-3xl font-bold">Demo controls</h1>
        <p className="text-white/90">Stage tools for the pitch. Demo data only.</p>
      </section>
      <div className="grid gap-6 px-4 py-6 md:px-8 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4 rounded-2xl border border-line bg-white p-4 shadow-card">
          <h2 className="font-semibold">1. Pick a reservation</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-medium">
              Room
              <select
                className={`${inputClass} mt-1`}
                value={roomId}
                onChange={(e) => (setRoomId(e.target.value), setPicked(null))}
              >
                <option value="">Choose a room…</option>
                {rooms.data?.rooms.map((r) => (
                  <option key={r.roomId} value={r.roomId}>
                    {r.name} —{' '}
                    {r.status === 'FREE' ? 'free' : r.status.toLowerCase().replaceAll('_', ' ')}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium">
              Day
              <input
                type="date"
                className={`${inputClass} mt-1 tabular`}
                min={today}
                max={addDays(today, 7)}
                value={day}
                onChange={(e) => setDay(e.target.value)}
              />
            </label>
          </div>
          {roomId && (
            <fieldset>
              <legend className="text-sm font-medium">Reservations</legend>
              {!reservations.length ? (
                <p className="mt-1 text-sm text-muted">
                  No active reservations in this room that day.
                </p>
              ) : (
                <div className="mt-1 space-y-1">
                  {reservations.map((r) => (
                    <label
                      key={r.id}
                      className="flex cursor-pointer items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm has-[:checked]:border-brown has-[:checked]:bg-cream"
                    >
                      <input
                        type="radio"
                        name="res"
                        className="accent-brown"
                        checked={picked === r.id}
                        onChange={() => setPicked(r.id)}
                      />
                      <span className="tabular">{fmtRange(r.start, r.end)}</span> · {r.ownerAlias} ·{' '}
                      {r.status.toLowerCase().replaceAll('_', ' ')}
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
          )}
          <h2 className="pt-2 font-semibold">2. Run</h2>
          <div className="flex flex-wrap gap-2">
            <Button disabled={!picked || run.isPending} onClick={() => run.mutate('conflict')}>
              <Zap className="size-4" aria-hidden /> Inject class conflict
            </Button>
            <Button
              variant="outline"
              disabled={!picked || run.isPending}
              onClick={() => run.mutate('forward')}
            >
              <FastForward className="size-4" aria-hidden /> Fast-forward to cutoff
            </Button>
            {confirmReset ? (
              <>
                <Button
                  variant="outline"
                  className="border-amber text-amber-ink"
                  disabled={run.isPending}
                  onClick={() => run.mutate('reset')}
                >
                  Confirm: delete all demo reservations
                </Button>
                <Button variant="ghost" onClick={() => setConfirmReset(false)}>
                  Keep data
                </Button>
              </>
            ) : (
              <Button variant="ghost" onClick={() => setConfirmReset(true)}>
                <RotateCcw className="size-4" aria-hidden /> Reset demo data
              </Button>
            )}
          </div>
        </div>
        <section
          className="rounded-2xl border border-line bg-espresso p-4 text-cream shadow-card"
          aria-labelledby="log-h"
        >
          <h2 id="log-h" className="mb-2 font-semibold">
            Live log
          </h2>
          <ol aria-live="polite" className="space-y-2 font-mono text-xs">
            {!log.length && <li className="text-cream/60">Waiting for an action…</li>}
            {log.map((l, i) => (
              <li key={i} className={cn(!l.ok && 'text-amber')}>
                <span className="text-cream/60 tabular">{fmtTime(l.at)}</span> {l.text}
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
