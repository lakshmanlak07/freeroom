/** P6 mock endpoints: confirm/cancel, events, claims + reveal, notifications read, demo controls. */
import {
  addDays,
  campusDay,
  campusLocalToUtc,
  canApproveClaim,
  canConfirm,
  cutoffAt,
} from '@freeroom/domain';
import type {
  ApproveMode,
  ClaimStatus,
  Notification,
  ReservationEventType,
} from '@freeroom/shared';
import { HttpResponse, delay, http } from 'msw';
import { ROOMS, USERS, db } from './data';

const err = (status: number, code: string, message: string) =>
  HttpResponse.json({ error: { code, message } }, { status });
const userOf = (req: Request) => req.headers.get('x-dev-user') ?? '';
const alias = (id: string) => db.registered.get(id)?.displayAlias ?? 'A FreeRoom user';

interface MockClaim {
  claimId: string;
  reservationId: string;
  requesterId: string;
  ownerId: string;
  status: ClaimStatus;
  mode: ApproveMode | null;
  message?: string;
  partySize: number;
  createdAt: string;
  expiresAt: string;
}
const claims: MockClaim[] = [];
const events = new Map<
  string,
  {
    eventId: string;
    type: ReservationEventType;
    at: string;
    actorAlias: string | null;
    reason?: string;
  }[]
>();
const log = (resId: string, type: ReservationEventType, actor: string | null, reason?: string) =>
  events.set(resId, [
    ...(events.get(resId) ?? []),
    {
      eventId: crypto.randomUUID(),
      type,
      at: new Date().toISOString(),
      actorAlias: actor ? alias(actor) : null,
      ...(reason && { reason }),
    },
  ]);
const notify = (userId: string, n: Omit<Notification, 'id' | 'read' | 'createdAt'>) =>
  db.notifications.set(userId, [
    { ...n, id: crypto.randomUUID(), read: false, createdAt: new Date().toISOString() },
    ...(db.notifications.get(userId) ?? []),
  ]);
const view = (c: MockClaim) => ({
  claimId: c.claimId,
  reservationId: c.reservationId,
  status: c.status,
  mode: c.mode,
  ...(c.message ? { message: c.message } : {}),
  partySize: c.partySize,
  requesterAlias: alias(c.requesterId),
  ownerAlias: alias(c.ownerId),
  createdAt: c.createdAt,
  expiresAt: c.expiresAt,
});

// Seed: student2 asked for student1's reservation (an incoming claim for student1), plus a
// class-conflict notification with 3 alternatives so the demo opens rich.
for (const r of db.reservations) log(r.id, 'CREATED', r.ownerId);
const mine = db.reservations.find((r) => r.ownerId === 'student1');
if (mine) {
  claims.push({
    claimId: `${mine.id}_seed`,
    reservationId: mine.id,
    requesterId: 'student2',
    ownerId: 'student1',
    status: 'PENDING',
    mode: null,
    message: 'Group of 4 for the COMPSCI 220 midterm — could we swap?',
    partySize: 4,
    createdAt: new Date().toISOString(),
    expiresAt: mine.cutoffAt,
  });
  log(mine.id, 'CLAIM_REQUESTED', 'student2');
}
{
  const day = addDays(campusDay(new Date()), 1);
  const at = (t: string) => campusLocalToUtc(`${day}T${t}`).toISOString();
  notify('student1', {
    type: 'reservation.class_conflict',
    reservationId: null,
    title: 'A class now needs your room',
    body: 'MATH 235 Linear Algebra was scheduled in LGRT 0201. Classes take priority — here are 3 free alternatives.',
    alternatives: ['LGRT-0211', 'LGRT-0221', 'ILC-0101'].map((id) => {
      const r = ROOMS.find((x) => x.roomId === id)!;
      return {
        roomId: r.roomId,
        name: r.name,
        buildingId: r.buildingId,
        buildingName: r.buildingName,
        capacity: r.capacity,
        start: at('15:00'),
        end: at('16:00'),
      };
    }),
  });
}

export const handlersP6 = [
  http.post('*/reservations/:id/confirm', async ({ request, params }) => {
    await delay(250);
    const r = db.reservations.find((x) => x.id === params.id);
    if (!r) return err(404, 'NOT_FOUND', 'Reservation not found');
    if (r.ownerId !== userOf(request)) return err(403, 'FORBIDDEN', 'Only the owner can confirm');
    const v = canConfirm({ status: r.status, start: new Date(r.start) }, new Date());
    if (!v.ok) return err(409, v.code, v.code);
    r.status = 'CONFIRMED';
    r.confirmedAt = new Date().toISOString();
    log(r.id, 'CONFIRMED', r.ownerId);
    return HttpResponse.json({
      ...r,
      ownerAlias: alias(r.ownerId),
      isMine: true,
      claimable: false,
      releaseReason: null,
    });
  }),

  http.delete('*/reservations/:id', async ({ request, params }) => {
    await delay(250);
    const r = db.reservations.find((x) => x.id === params.id);
    if (!r) return err(404, 'NOT_FOUND', 'Reservation not found');
    const u = userOf(request);
    if (r.ownerId !== u && USERS[u]?.role !== 'ADMIN')
      return err(403, 'FORBIDDEN', 'Only the owner can cancel');
    if (r.status !== 'PENDING_CONFIRMATION' && r.status !== 'CONFIRMED')
      return err(409, 'INVALID_TRANSITION', `Reservation is ${r.status}`);
    r.status = 'CANCELLED';
    log(r.id, 'CANCELLED', u);
    return HttpResponse.json({
      ...r,
      ownerAlias: alias(r.ownerId),
      isMine: true,
      claimable: false,
      releaseReason: null,
    });
  }),

  http.get('*/reservations/:id/events', ({ params }) =>
    HttpResponse.json({ events: events.get(String(params.id)) ?? [] }),
  ),

  http.get('*/me/claims', ({ request }) => {
    const u = userOf(request);
    const incoming = new URL(request.url).searchParams.get('direction') === 'incoming';
    return HttpResponse.json({
      claims: claims.filter((c) => (incoming ? c.ownerId : c.requesterId) === u).map(view),
    });
  }),

  http.post('*/claims/:id/:action', async ({ request, params }) => {
    await delay(300);
    const c = claims.find((x) => x.claimId === params.id);
    if (!c) return err(404, 'NOT_FOUND', 'Claim not found');
    const r = db.reservations.find((x) => x.id === c.reservationId)!;
    const u = userOf(request);
    if (params.action === 'withdraw') {
      if (u !== c.requesterId) return err(403, 'FORBIDDEN', 'Not your claim');
      if (c.status !== 'PENDING')
        return err(409, 'INVALID_TRANSITION', 'Claim is no longer pending');
      c.status = 'WITHDRAWN';
      return HttpResponse.json(view(c));
    }
    if (u !== r.ownerId)
      return err(403, 'FORBIDDEN', 'Only the reservation owner can decide claims');
    if (params.action === 'deny') {
      if (c.status !== 'PENDING')
        return err(409, 'INVALID_TRANSITION', 'Claim is no longer pending');
      c.status = 'DENIED';
      log(r.id, 'CLAIM_DENIED', u);
      notify(c.requesterId, {
        type: 'claim.denied',
        reservationId: r.id,
        title: 'Your room request was declined',
        body: 'Try another free room nearby.',
      });
      return HttpResponse.json(view(c));
    }
    const v = canApproveClaim(c, { status: r.status, start: new Date(r.start) }, new Date());
    if (!v.ok) return err(409, v.code, v.code);
    const { mode } = (await request.json()) as { mode: ApproveMode };
    c.status = 'APPROVED';
    c.mode = mode;
    log(r.id, 'CLAIM_APPROVED', u);
    if (mode === 'TRANSFER') {
      r.ownerId = c.requesterId;
      r.status = 'CONFIRMED';
      log(r.id, 'TRANSFERRED', u);
    }
    notify(c.requesterId, {
      type: 'claim.approved',
      reservationId: r.id,
      title: 'Your room request was approved',
      body:
        mode === 'TRANSFER'
          ? 'The reservation is now yours.'
          : 'The owner shared their contact details.',
    });
    return HttpResponse.json(view(c));
  }),

  http.get('*/claims/:id/contact', ({ request, params }) => {
    const c = claims.find((x) => x.claimId === params.id);
    if (!c) return err(404, 'NOT_FOUND', 'Claim not found');
    if (
      c.requesterId !== userOf(request) ||
      c.status !== 'APPROVED' ||
      c.mode !== 'SHARE_CONTACT'
    ) {
      return err(403, 'FORBIDDEN', 'Contact is shared only after an approved request');
    }
    const owner = db.registered.get(c.ownerId)!;
    const r = db.reservations.find((x) => x.id === c.reservationId)!;
    return HttpResponse.json({
      channel: owner.shareChannel,
      value: owner.contact[owner.shareChannel] ?? '',
      expiresAt: new Date(Date.parse(r.end) + 24 * 3_600_000).toISOString(),
    });
  }),

  http.post('*/me/notifications/read', async ({ request }) => {
    const u = userOf(request);
    const body = (await request.json()) as { ids?: string[]; all?: boolean };
    const list = db.notifications.get(u) ?? [];
    let updated = 0;
    for (const n of list) {
      if (n.read || !(body.all || body.ids?.includes(n.id))) continue;
      n.read = true;
      updated++;
    }
    return HttpResponse.json({ updated });
  }),

  http.get('*/demo/status', () => HttpResponse.json({ lastReset: null })),

  http.post('*/demo/:action', async ({ request, params }) => {
    await delay(500);
    if (USERS[userOf(request)]?.role !== 'ADMIN') return err(403, 'FORBIDDEN', 'Admin only');
    if (params.action === 'reset') {
      const n = db.reservations.length;
      db.reservations.length = 0;
      claims.length = 0;
      return HttpResponse.json({ deleted: n });
    }
    const { reservationId } = (await request.json()) as { reservationId: string };
    const r = db.reservations.find((x) => x.id === reservationId);
    if (!r) return err(404, 'NOT_FOUND', 'Reservation not found');
    if (params.action === 'fast-forward') {
      const released = r.status === 'PENDING_CONFIRMATION';
      if (released) {
        r.status = 'RELEASED';
        log(r.id, 'RELEASED', null, 'UNCONFIRMED');
        notify(r.ownerId, {
          type: 'reservation.auto_released',
          reservationId: r.id,
          title: 'Reservation auto-released',
          body: 'It was not confirmed before the 4-hour cutoff.',
        });
      }
      const expired = claims.filter((c) => c.reservationId === r.id && c.status === 'PENDING');
      for (const c of expired) c.status = 'EXPIRED';
      return HttpResponse.json({
        released: Number(released),
        expired: expired.length,
        status: r.status,
        cutoffAt: cutoffAt(new Date(r.start)).toISOString(),
      });
    }
    r.status = 'RELEASED';
    log(r.id, 'CONFLICTED', null);
    log(r.id, 'RELEASED', null, 'CLASS_CONFLICT');
    const alts = ROOMS.filter(
      (x) => x.buildingId === r.roomId.split('-')[0] && x.roomId !== r.roomId,
    ).slice(0, 3);
    notify(r.ownerId, {
      type: 'reservation.class_conflict',
      reservationId: r.id,
      title: 'A class now needs your room',
      body: `DEMO 101 Pop-up Lecture was scheduled in ${r.roomId.replace('-', ' ')}. Here are ${alts.length} free alternatives.`,
      alternatives: alts.map((x) => ({
        roomId: x.roomId,
        name: x.name,
        buildingId: x.buildingId,
        buildingName: x.buildingName,
        capacity: x.capacity,
        start: r.start,
        end: r.end,
      })),
    });
    return HttpResponse.json({ status: 'RELEASED', releaseReason: 'CLASS_CONFLICT' });
  }),
];

/** Mock-only: lets the claim modal's POST also register here so incoming/outgoing lists stay in sync. */
export function trackClaim(c: Omit<MockClaim, 'status' | 'mode'>) {
  claims.push({ ...c, status: 'PENDING', mode: null });
  log(c.reservationId, 'CLAIM_REQUESTED', c.requesterId);
  notify(c.ownerId, {
    type: 'claim.received',
    reservationId: c.reservationId,
    title: 'Someone requested your room',
    body: 'Approve or deny before the 4-hour cutoff.',
  });
}
