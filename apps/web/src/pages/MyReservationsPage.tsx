/** F6: My Reservations — upcoming/past, confirm (BR-6 window), cancel, claims in/out, history. */
import * as Dialog from '@radix-ui/react-dialog';
import { canConfirm, confirmWindowOpensAt, cutoffAt } from '@freeroom/domain';
import type { Claim, ReservationDetail } from '@freeroom/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarX, CheckCircle2, Clock, History, Inbox, Mail, Phone, Send, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { ApiError } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { EmptyState, Skeleton } from '@/components/EmptyState';
import { useToast } from '@/components/Toast';
import { Button } from '@/components/ui/button';
import { campusDay, fmtDay, fmtDuration, fmtRange, fmtTime, useNow } from '@/lib/time';
import { cn } from '@/lib/utils';

const PILL: Record<string, [string, string]> = {
  PENDING_CONFIRMATION: ['Pending confirmation', 'bg-amber/10 text-amber-ink'],
  CONFIRMED: ['Confirmed', 'bg-free-50 text-free-ink'],
  RELEASED: ['Released', 'bg-line text-muted'],
  CANCELLED: ['Cancelled', 'bg-line text-muted'],
  CONFLICTED: ['Class conflict', 'bg-amber/10 text-amber-ink'],
  COMPLETED: ['Completed', 'bg-line text-muted'],
  PENDING: ['Pending', 'bg-amber/10 text-amber-ink'],
  APPROVED: ['Approved', 'bg-free-50 text-free-ink'],
  DENIED: ['Declined', 'bg-line text-muted'],
  EXPIRED: ['Expired', 'bg-line text-muted'],
  WITHDRAWN: ['Withdrawn', 'bg-line text-muted'],
};
export function Pill({ status }: { status: string }) {
  const [label, cls] = PILL[status] ?? [status, 'bg-line text-muted'];
  return (
    <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', cls)}>{label}</span>
  );
}
const roomName = (roomId: string) => roomId.replace('-', ' ');
const explain = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong');

export function MyReservationsPage() {
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const [history, setHistory] = useState<ReservationDetail | null>(null);
  return (
    <div>
      <section className="bg-brand-gradient px-4 pt-8 pb-14 text-white md:px-8">
        <h1 className="text-3xl font-bold">My reservations</h1>
        <p className="text-white/90">
          Confirm between 24h and 4h before start — or it’s released automatically.
        </p>
      </section>
      <div className="space-y-8 px-4 py-6 md:px-8">
        <div
          role="tablist"
          aria-label="Reservations"
          className="inline-flex rounded-xl border border-line bg-surface p-0.5"
        >
          {(['upcoming', 'past'] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={cn(
                'rounded-lg px-4 py-1.5 text-sm font-semibold capitalize',
                tab === t ? 'bg-brown text-white' : 'text-muted',
              )}
            >
              {t}
            </button>
          ))}
        </div>
        <ReservationList scope={tab} onHistory={setHistory} />
        <IncomingClaims />
        <OutgoingClaims />
      </div>
      <HistoryDrawer reservation={history} onClose={() => setHistory(null)} />
    </div>
  );
}

function ReservationList({
  scope,
  onHistory,
}: {
  scope: 'upcoming' | 'past';
  onHistory: (r: ReservationDetail) => void;
}) {
  const { api } = useAuth();
  const q = useQuery({
    queryKey: ['myReservations', scope],
    queryFn: () => api.myReservations(scope),
    refetchInterval: 10_000,
  });
  if (q.isLoading) return <Skeleton className="h-32" />;
  if (q.isError)
    return (
      <EmptyState
        tone="error"
        icon={CalendarX}
        title="Couldn’t load reservations"
        body={q.error.message}
      />
    );
  const list = q.data!.reservations;
  if (!list.length) {
    return (
      <EmptyState
        icon={CalendarX}
        title={scope === 'upcoming' ? 'No upcoming reservations' : 'Nothing here yet'}
        action={
          scope === 'upcoming' ? (
            <Link className="font-semibold text-brown-ink underline" to="/">
              Find a free room
            </Link>
          ) : undefined
        }
      />
    );
  }
  return (
    <ul className="space-y-3" aria-label={`${scope} reservations`}>
      {list.map((r) => (
        <ReservationRow key={r.id} r={r} onHistory={() => onHistory(r)} />
      ))}
    </ul>
  );
}

function ReservationRow({ r, onHistory }: { r: ReservationDetail; onHistory: () => void }) {
  const { api } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const now = useNow(30_000);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const start = new Date(r.start);
  const cutoff = cutoffAt(start);
  const opens = confirmWindowOpensAt(start);
  const check = canConfirm({ status: r.status, start }, now);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['myReservations'] });
  const confirm = useMutation({
    mutationFn: () => api.confirmReservation(r.id),
    onSuccess: () => (
      toast({
        tone: 'success',
        title: 'Confirmed',
        body: `${roomName(r.roomId)} · ${fmtRange(r.start, r.end)}`,
      }),
      refresh()
    ),
    onError: (e) => toast({ tone: 'error', title: 'Couldn’t confirm', body: explain(e) }),
  });
  const cancel = useMutation({
    mutationFn: () => api.cancelReservation(r.id),
    onSuccess: () => (toast({ tone: 'info', title: 'Reservation cancelled' }), refresh()),
    onError: (e) => toast({ tone: 'error', title: 'Couldn’t cancel', body: explain(e) }),
  });
  const active = r.status === 'PENDING_CONFIRMATION' || r.status === 'CONFIRMED';

  return (
    <li className="flex flex-wrap items-center gap-4 rounded-2xl border border-line bg-surface p-4 shadow-card">
      <div className="min-w-[16rem] flex-1">
        <Link
          to={`/rooms/${encodeURIComponent(r.roomId)}?date=${campusDay(start)}`}
          className="text-lg font-semibold hover:underline"
        >
          {roomName(r.roomId)}
        </Link>
        <p className="text-sm text-muted tabular">
          {fmtDay(campusDay(start))} · {fmtRange(r.start, r.end)} · party of {r.partySize}
        </p>
        {r.status === 'PENDING_CONFIRMATION' && (
          <p className="mt-1 flex items-center gap-1.5 text-xs text-amber-ink tabular">
            <Clock className="size-3.5" aria-hidden />
            {now < opens
              ? `Confirmation opens ${fmtDay(campusDay(opens))}, ${fmtTime(opens)} (in ${fmtDuration(opens.getTime() - now.getTime())})`
              : now < cutoff
                ? `Confirm by ${fmtTime(cutoff)} — ${fmtDuration(cutoff.getTime() - now.getTime())} left`
                : 'Cutoff passed — releasing automatically'}
          </p>
        )}
      </div>
      <Pill status={r.status} />
      <div className="flex flex-wrap gap-2">
        {r.status === 'PENDING_CONFIRMATION' && (
          <Button
            size="sm"
            disabled={!check.ok || confirm.isPending}
            onClick={() => confirm.mutate()}
            title={
              check.ok
                ? undefined
                : check.code === 'TOO_EARLY'
                  ? 'Confirmation window not open yet'
                  : 'Past the 4-hour cutoff'
            }
          >
            <CheckCircle2 className="size-4" aria-hidden /> Confirm
          </Button>
        )}
        {active &&
          (confirmCancel ? (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => cancel.mutate()}
                disabled={cancel.isPending}
              >
                Yes, cancel
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmCancel(false)}>
                Keep it
              </Button>
            </>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setConfirmCancel(true)}>
              Cancel
            </Button>
          ))}
        <Button
          size="sm"
          variant="ghost"
          onClick={onHistory}
          aria-label={`History for ${roomName(r.roomId)}`}
        >
          <History className="size-4" aria-hidden /> History
        </Button>
      </div>
    </li>
  );
}

function ClaimCard({ c, children }: { c: Claim; children?: React.ReactNode }) {
  return (
    <li className="rounded-2xl border border-line bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-semibold">
          {c.requesterAlias} → {c.ownerAlias}
        </p>
        <Pill status={c.status} />
        <span className="ml-auto text-xs text-muted tabular">party of {c.partySize}</span>
      </div>
      {c.message && <p className="mt-2 rounded-xl bg-cream px-3 py-2 text-sm">“{c.message}”</p>}
      {children}
    </li>
  );
}

function IncomingClaims() {
  const { api } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const now = useNow(30_000);
  const [choosing, setChoosing] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['claims', 'incoming'],
    queryFn: () => api.myClaims('incoming'),
    refetchInterval: 10_000,
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['claims'] });
    void qc.invalidateQueries({ queryKey: ['myReservations'] });
  };
  const decide = useMutation({
    mutationFn: (v: { id: string; action: 'SHARE_CONTACT' | 'TRANSFER' | 'deny' }) =>
      v.action === 'deny' ? api.denyClaim(v.id) : api.approveClaim(v.id, v.action),
    onSuccess: (_, v) => {
      setChoosing(null);
      toast({
        tone: 'success',
        title:
          v.action === 'deny'
            ? 'Request declined'
            : v.action === 'TRANSFER'
              ? 'Reservation transferred'
              : 'Contact shared',
      });
      refresh();
    },
    onError: (e) =>
      toast({ tone: 'error', title: 'Couldn’t update the request', body: explain(e) }),
  });
  return (
    <section aria-labelledby="incoming-h">
      <h2 id="incoming-h" className="mb-3 flex items-center gap-2 text-xl font-bold">
        <Inbox className="size-5" aria-hidden /> Incoming requests
      </h2>
      {q.isLoading ? (
        <Skeleton className="h-24" />
      ) : !q.data?.claims.length ? (
        <p className="text-sm text-muted">No one has asked for your rooms.</p>
      ) : (
        <ul className="space-y-3">
          {q.data.claims.map((c) => {
            const open = c.status === 'PENDING' && now < new Date(c.expiresAt);
            return (
              <ClaimCard key={c.claimId} c={c}>
                {c.status === 'PENDING' && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {!open ? (
                      <p className="text-sm text-muted">
                        Past the 4-hour cutoff — this request is expiring and can’t be approved.
                      </p>
                    ) : choosing === c.claimId ? (
                      <>
                        <Button
                          size="sm"
                          onClick={() => decide.mutate({ id: c.claimId, action: 'SHARE_CONTACT' })}
                          disabled={decide.isPending}
                        >
                          Share my contact
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => decide.mutate({ id: c.claimId, action: 'TRANSFER' })}
                          disabled={decide.isPending}
                        >
                          Transfer reservation
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setChoosing(null)}>
                          Back
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button size="sm" onClick={() => setChoosing(c.claimId)}>
                          Approve…
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => decide.mutate({ id: c.claimId, action: 'deny' })}
                          disabled={decide.isPending}
                        >
                          Deny
                        </Button>
                        <span className="text-xs text-muted tabular">
                          Decide by {fmtTime(c.expiresAt)} (
                          {fmtDuration(Date.parse(c.expiresAt) - now.getTime())})
                        </span>
                      </>
                    )}
                  </div>
                )}
              </ClaimCard>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function OutgoingClaims() {
  const { api } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['claims', 'outgoing'],
    queryFn: () => api.myClaims('outgoing'),
    refetchInterval: 10_000,
  });
  const withdraw = useMutation({
    mutationFn: (id: string) => api.withdrawClaim(id),
    onSuccess: () => (
      toast({ tone: 'info', title: 'Request withdrawn' }),
      void qc.invalidateQueries({ queryKey: ['claims'] })
    ),
    onError: (e) => toast({ tone: 'error', title: 'Couldn’t withdraw', body: explain(e) }),
  });
  return (
    <section aria-labelledby="outgoing-h">
      <h2 id="outgoing-h" className="mb-3 flex items-center gap-2 text-xl font-bold">
        <Send className="size-5" aria-hidden /> Your requests
      </h2>
      {q.isLoading ? (
        <Skeleton className="h-24" />
      ) : !q.data?.claims.length ? (
        <p className="text-sm text-muted">You haven’t asked for any rooms.</p>
      ) : (
        <ul className="space-y-3">
          {q.data.claims.map((c) => (
            <ClaimCard key={c.claimId} c={c}>
              <div className="mt-3">
                {c.status === 'PENDING' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => withdraw.mutate(c.claimId)}
                    disabled={withdraw.isPending}
                  >
                    Withdraw
                  </Button>
                )}
                {c.status === 'APPROVED' && c.mode === 'SHARE_CONTACT' && (
                  <ContactCard claimId={c.claimId} />
                )}
                {c.status === 'APPROVED' && c.mode === 'TRANSFER' && (
                  <p className="text-sm text-free-ink">
                    The reservation is now yours — see it above.
                  </p>
                )}
              </div>
            </ClaimCard>
          ))}
        </ul>
      )}
    </section>
  );
}

/** BR-5: fetched only on demand, only for the approved requester; never cached across users. */
function ContactCard({ claimId }: { claimId: string }) {
  const { api } = useAuth();
  const [show, setShow] = useState(false);
  const q = useQuery({
    queryKey: ['contact', claimId],
    queryFn: () => api.claimContact(claimId),
    enabled: show,
    gcTime: 0,
  });
  if (!show) {
    return (
      <Button size="sm" onClick={() => setShow(true)}>
        Show contact
      </Button>
    );
  }
  if (q.isLoading) return <Skeleton className="h-14" />;
  if (q.isError) return <p className="text-sm text-amber-ink">{explain(q.error)}</p>;
  const { channel, value, expiresAt } = q.data!;
  const Icon = channel === 'email' ? Mail : Phone;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-free bg-free-50 p-3">
      <Icon className="size-5 text-free-ink" aria-hidden />
      <div>
        <a
          className="font-semibold text-free-ink underline"
          href={channel === 'email' ? `mailto:${value}` : `tel:${value}`}
        >
          {value}
        </a>
        <p className="text-xs text-muted">
          Shared by the owner · visible until {fmtDay(campusDay(new Date(expiresAt)))}{' '}
          {fmtTime(expiresAt)}
        </p>
      </div>
    </div>
  );
}

const EVENT_LABEL: Record<string, string> = {
  CREATED: 'Reserved',
  CONFIRMED: 'Confirmed',
  CLAIM_REQUESTED: 'Someone requested the room',
  CLAIM_APPROVED: 'Request approved',
  CLAIM_DENIED: 'Request declined',
  CLAIM_EXPIRED: 'Request expired',
  TRANSFERRED: 'Ownership transferred',
  RELEASED: 'Released',
  CANCELLED: 'Cancelled',
  CONFLICTED: 'A class was scheduled here',
};

function HistoryDrawer({
  reservation,
  onClose,
}: {
  reservation: ReservationDetail | null;
  onClose: () => void;
}) {
  const { api } = useAuth();
  const q = useQuery({
    queryKey: ['events', reservation?.id],
    queryFn: () => api.reservationEvents(reservation!.id),
    enabled: !!reservation,
  });
  return (
    <Dialog.Root open={!!reservation} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content className="fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-y-auto bg-surface p-6 shadow-2xl">
          <div className="flex items-start justify-between">
            <Dialog.Title className="text-xl font-semibold">History</Dialog.Title>
            <Dialog.Close className="rounded-lg p-1 text-muted hover:bg-cream" aria-label="Close">
              <X className="size-5" />
            </Dialog.Close>
          </div>
          {reservation && (
            <Dialog.Description className="text-sm text-muted">
              {roomName(reservation.roomId)} · {fmtRange(reservation.start, reservation.end)}
            </Dialog.Description>
          )}
          {q.isLoading ? (
            <Skeleton className="mt-6 h-40" />
          ) : (
            <ol className="mt-6 space-y-4 border-l-2 border-line pl-4">
              {q.data?.events.map((e) => (
                <li key={e.eventId} className="relative">
                  <span
                    className="absolute top-1.5 -left-[1.4rem] size-2.5 rounded-full bg-brown"
                    aria-hidden
                  />
                  <p className="font-semibold">{EVENT_LABEL[e.type] ?? e.type}</p>
                  <p className="text-xs text-muted tabular">
                    {fmtDay(campusDay(new Date(e.at)))} {fmtTime(e.at)}
                    {e.actorAlias ? ` · ${e.actorAlias}` : ' · FreeRoom'}
                    {e.reason ? ` · ${e.reason.replace('_', ' ').toLowerCase()}` : ''}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
