/**
 * Typed API client. Every response is validated with the zod schemas in @freeroom/shared,
 * so web and api share one contract.
 */
import {
  ApiErrorSchema,
  BuildingsResponseSchema,
  ClaimSchema,
  MeResponseSchema,
  MyReservationsResponseSchema,
  NaturalSearchResponseSchema,
  NotificationsResponseSchema,
  RegisterResponseSchema,
  ReservationDetailSchema,
  ReservationResponseSchema,
  RoomSchema,
  RoomSearchResponseSchema,
  ScheduleResponseSchema,
  type CreateClaimRequest,
  type CreateReservationRequest,
  type ErrorCode,
  type RegisterRequest,
  ContactRevealResponseSchema,
  DemoStatusSchema,
  MyClaimsResponseSchema,
  ReservationEventsResponseSchema,
  InviteCreateResponseSchema,
  InvitePreviewSchema,
  RouteResponseSchema,
  type ApproveMode,
} from '@freeroom/shared';

/** Untyped JSON object (demo/admin responses that the UI only logs). */
const AnyObject = { parse: (d: unknown) => (d ?? {}) as Record<string, unknown> };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'NETWORK',
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

interface Parser<T> {
  parse(data: unknown): T;
}

export interface RoomSearchParams {
  building?: string;
  minCapacity?: number;
  equipment?: string[];
  freeNow?: boolean;
  freeFrom?: string;
  freeTo?: string;
  sort?: string;
}

const qs = (o: Record<string, unknown>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v === '' || v === false || (Array.isArray(v) && !v.length)) continue;
    p.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
};

export function createApi(baseUrl: string, authHeaders: () => Promise<Record<string, string>>) {
  async function request<T>(
    method: string,
    path: string,
    schema: Parser<T>,
    opts: { body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<T> {
    let res: Response;
    try {
      res = await fetch(baseUrl.replace(/\/$/, '') + path, {
        method,
        headers: {
          ...(opts.body !== undefined && { 'content-type': 'application/json' }),
          ...(await authHeaders()),
          ...opts.headers,
        },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      });
    } catch {
      throw new ApiError(0, 'NETWORK', 'Can’t reach FreeRoom right now. Check your connection.');
    }
    const json: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const e = ApiErrorSchema.safeParse(json);
      throw e.success
        ? new ApiError(res.status, e.data.error.code, e.data.error.message, e.data.error.details)
        : new ApiError(res.status, 'INTERNAL', 'Something went wrong. Please try again.');
    }
    return schema.parse(json);
  }

  return {
    buildings: () => request('GET', '/buildings', BuildingsResponseSchema),
    rooms: (q: RoomSearchParams) =>
      request('GET', `/rooms${qs({ ...q })}`, RoomSearchResponseSchema),
    /** Free text → parsed filters + rooms (Bedrock or the deterministic parser). */
    naturalSearch: (query: string) =>
      request('POST', '/rooms/search/natural', NaturalSearchResponseSchema, { body: { query } }),
    room: (id: string) => request('GET', `/rooms/${encodeURIComponent(id)}`, RoomSchema),
    schedule: (id: string, from: string, to: string) =>
      request(
        'GET',
        `/rooms/${encodeURIComponent(id)}/schedule${qs({ from, to })}`,
        ScheduleResponseSchema,
      ),
    reservation: (id: string) =>
      request('GET', `/reservations/${encodeURIComponent(id)}`, ReservationResponseSchema),
    createReservation: (body: CreateReservationRequest, idempotencyKey: string) =>
      request('POST', '/reservations', ReservationDetailSchema, {
        body,
        headers: { 'idempotency-key': idempotencyKey },
      }),
    myReservations: (scope: 'upcoming' | 'past') =>
      request('GET', `/me/reservations${qs({ scope })}`, MyReservationsResponseSchema),
    createClaim: (reservationId: string, body: CreateClaimRequest) =>
      request('POST', `/reservations/${encodeURIComponent(reservationId)}/claims`, ClaimSchema, {
        body,
      }),
    notifications: () => request('GET', '/me/notifications', NotificationsResponseSchema),
    /** null = signed in but not registered yet (404). */
    me: async () => {
      try {
        return await request('GET', '/me', MeResponseSchema);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
    register: (body: RegisterRequest) =>
      request('POST', '/register', RegisterResponseSchema, { body }),

    // ---- P6: reservations lifecycle, claims, notifications, demo controls
    confirmReservation: (id: string) =>
      request('POST', `/reservations/${encodeURIComponent(id)}/confirm`, ReservationDetailSchema),
    cancelReservation: (id: string) =>
      request('DELETE', `/reservations/${encodeURIComponent(id)}`, ReservationDetailSchema),
    reservationEvents: (id: string) =>
      request(
        'GET',
        `/reservations/${encodeURIComponent(id)}/events`,
        ReservationEventsResponseSchema,
      ),
    myClaims: (direction: 'incoming' | 'outgoing') =>
      request('GET', `/me/claims${qs({ direction })}`, MyClaimsResponseSchema),
    approveClaim: (claimId: string, mode: ApproveMode) =>
      request('POST', `/claims/${encodeURIComponent(claimId)}/approve`, ClaimSchema, {
        body: { mode },
      }),
    denyClaim: (claimId: string) =>
      request('POST', `/claims/${encodeURIComponent(claimId)}/deny`, ClaimSchema),
    withdrawClaim: (claimId: string) =>
      request('POST', `/claims/${encodeURIComponent(claimId)}/withdraw`, ClaimSchema),
    /** BR-5: the only call that returns another user's contact (approved requester only). */
    claimContact: (claimId: string) =>
      request('GET', `/claims/${encodeURIComponent(claimId)}/contact`, ContactRevealResponseSchema),
    markRead: (body: { ids: string[] } | { all: true }) =>
      request('POST', '/me/notifications/read', AnyObject, { body }),
    demo: {
      injectConflict: (reservationId: string) =>
        request('POST', '/demo/inject-conflict', AnyObject, { body: { reservationId } }),
      fastForward: (reservationId: string) =>
        request('POST', '/demo/fast-forward', AnyObject, { body: { reservationId } }),
      reset: () => request('POST', '/demo/reset', AnyObject),
      status: () => request('GET', '/demo/status', DemoStatusSchema),
    },

    // ---- Directions (features.directions)
    /** from = "lat,lng" (rounded server-side, never stored) or "building:<id>". */
    route: (roomId: string, from: string, accessible: boolean) =>
      request(
        'GET',
        `/rooms/${encodeURIComponent(roomId)}/route${qs({ from, accessible: accessible ? 'true' : undefined })}`,
        RouteResponseSchema,
      ),

    // ---- Group invites (features.invites)
    createInvite: (reservationId: string) =>
      request(
        'POST',
        `/reservations/${encodeURIComponent(reservationId)}/invites`,
        InviteCreateResponseSchema,
      ),
    revokeInvite: (reservationId: string) =>
      request('DELETE', `/reservations/${encodeURIComponent(reservationId)}/invites`, AnyObject),
    invite: (token: string) =>
      request('GET', `/invites/${encodeURIComponent(token)}`, InvitePreviewSchema),
    joinInvite: (token: string) =>
      request('POST', `/invites/${encodeURIComponent(token)}/join`, AnyObject),
    leaveReservation: (reservationId: string) =>
      request('DELETE', `/reservations/${encodeURIComponent(reservationId)}/attendance`, AnyObject),
    /** Owner/attendee calendar file: fetched with auth headers, then saved as a download. */
    downloadCalendar: async (reservationId: string, fileName: string) => {
      const res = await fetch(
        `${baseUrl.replace(/\/$/, '')}/reservations/${encodeURIComponent(reservationId)}/calendar.ics`,
        { headers: await authHeaders() },
      );
      if (!res.ok) throw new ApiError(res.status, 'INTERNAL', 'Couldn’t make the calendar file.');
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    /** Public calendar file for an invite (works signed out). */
    inviteCalendarUrl: (token: string) =>
      `${baseUrl.replace(/\/$/, '')}/invites/${encodeURIComponent(token)}/calendar.ics`,
  };
}

export type Api = ReturnType<typeof createApi>;
