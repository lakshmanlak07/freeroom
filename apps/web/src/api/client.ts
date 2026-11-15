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
  };
}

export type Api = ReturnType<typeof createApi>;
