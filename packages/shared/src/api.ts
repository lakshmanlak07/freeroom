/**
 * API contract (PRD §7, scoped by §0.2). Single source of truth for web + api.
 * Follows and WebSockets are v1.1 (§0.3), so they are not here.
 */
import { z } from 'zod';
import {
  ApproveModeSchema,
  ClaimStatusSchema,
  EquipmentSchema,
  ReleaseReasonSchema,
  ReservationEventTypeSchema,
  ReservationStatusSchema,
  RoleSchema,
  RoomStatusSchema,
  ShareChannelSchema,
} from './enums';

export const IsoDateTime = z.string().datetime({ offset: true });
const Id = z.string().min(1).max(128);
const PartySize = z.number().int().min(1).max(500);
/** Plain text, bounded, no markup. */
const SafeText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((s) => !/[<>]/.test(s), 'HTML is not allowed');

// ---------- Auth / profile ----------
export const ContactSchema = z
  .object({
    email: z.string().email().max(254).optional(),
    phone: z
      .string()
      .regex(/^\+?[0-9 ()-]{7,20}$/)
      .optional(),
  })
  .refine((c) => c.email || c.phone, 'email or phone required');

/**
 * No `role` field: clients can't pick their own role (privilege escalation via quotas).
 * Server assigns STUDENT; FACULTY/TUTOR/ADMIN are set only by admins/seed data (later: SSO claims).
 * `.strict()` rejects a smuggled `role` instead of silently dropping it.
 */
export const RegisterRequestSchema = z
  .object({
    universityId: z.string().regex(/^[0-9A-Za-z]{5,12}$/),
    displayAlias: SafeText(40).pipe(z.string().min(1)),
    contact: ContactSchema,
    shareChannel: ShareChannelSchema,
  })
  .strict();
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

/** Own profile. Contact is present only on /me (self). Never universityId/uidHash. */
export const MeResponseSchema = z.object({
  userId: Id,
  role: RoleSchema,
  displayAlias: z.string(),
  contact: z.object({ email: z.string().optional(), phone: z.string().optional() }),
  shareChannel: ShareChannelSchema,
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

export const UpdateMeRequestSchema = z
  .object({
    displayAlias: SafeText(40).pipe(z.string().min(1)),
    contact: ContactSchema,
    shareChannel: ShareChannelSchema,
  })
  .partial();
export type UpdateMeRequest = z.infer<typeof UpdateMeRequestSchema>;

// ---------- Buildings / rooms ----------
export const BuildingSchema = z.object({
  buildingId: Id,
  name: z.string(),
  lat: z.number(),
  lng: z.number(),
  roomCount: z.number().int(),
  freePct: z.number().min(0).max(100),
});
export type Building = z.infer<typeof BuildingSchema>;
export const BuildingsResponseSchema = z.object({ buildings: z.array(BuildingSchema) });

export const RoomSchema = z.object({
  roomId: Id,
  buildingId: Id,
  buildingName: z.string(),
  name: z.string(),
  capacity: z.number().int(),
  equipment: z.array(EquipmentSchema),
  lat: z.number(),
  lng: z.number(),
});
export type Room = z.infer<typeof RoomSchema>;

export const RoomWithStatusSchema = RoomSchema.extend({
  status: RoomStatusSchema,
  freeUntil: IsoDateTime.nullable(),
});
export type RoomWithStatus = z.infer<typeof RoomWithStatusSchema>;

const csv = <T extends z.ZodTypeAny>(item: T) =>
  z
    .string()
    .transform((s) => s.split(',').filter(Boolean))
    .pipe(z.array(item));

export const RoomSearchQuerySchema = z.object({
  building: Id.optional(),
  minCapacity: z.coerce.number().int().min(1).optional(),
  equipment: csv(EquipmentSchema).optional(),
  freeFrom: IsoDateTime.optional(),
  freeTo: IsoDateTime.optional(),
  freeNow: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  sort: z.enum(['soonestFree', 'longestFree', 'capacity', 'distance']).optional(),
});
export type RoomSearchQuery = z.infer<typeof RoomSearchQuerySchema>;
export const RoomSearchResponseSchema = z.object({ rooms: z.array(RoomWithStatusSchema) });

export const NaturalSearchRequestSchema = z.object({
  query: SafeText(300).pipe(z.string().min(3)),
});
export const NaturalSearchResponseSchema = z.object({
  filters: RoomSearchQuerySchema.partial(),
  rooms: z.array(RoomWithStatusSchema),
});

export const ScheduleQuerySchema = z.object({ from: IsoDateTime, to: IsoDateTime });

export const ClassItemSchema = z.object({
  kind: z.literal('class'),
  eventId: Id,
  name: z.string(),
  courseCode: z.string().optional(),
  section: z.string().optional(),
  eventType: z.string().optional(),
  organization: z.string().optional(),
  start: IsoDateTime,
  end: IsoDateTime,
  roomId: Id,
  roomName: z.string(),
  buildingName: z.string(),
});
export type ClassItem = z.infer<typeof ClassItemSchema>;

/** Public view of a reservation: owner alias only (BR-5). */
export const ReservationItemSchema = z.object({
  kind: z.literal('reservation'),
  id: Id,
  roomId: Id,
  start: IsoDateTime,
  end: IsoDateTime,
  status: ReservationStatusSchema,
  ownerAlias: z.string(),
  isMine: z.boolean(),
  claimable: z.boolean(),
});
export type ReservationItem = z.infer<typeof ReservationItemSchema>;

export const ScheduleResponseSchema = z.object({
  items: z.array(z.discriminatedUnion('kind', [ClassItemSchema, ReservationItemSchema])),
  staleness: z.object({ lastSyncedAt: IsoDateTime.nullable() }),
});
export type ScheduleResponse = z.infer<typeof ScheduleResponseSchema>;

// ---------- Reservations ----------
export const CreateReservationRequestSchema = z.object({
  roomId: Id,
  start: IsoDateTime,
  end: IsoDateTime,
  partySize: PartySize,
  purpose: SafeText(140).optional(),
});
export type CreateReservationRequest = z.infer<typeof CreateReservationRequestSchema>;

export const ReservationDetailSchema = ReservationItemSchema.omit({ kind: true }).extend({
  partySize: PartySize,
  purpose: z.string().optional(),
  cutoffAt: IsoDateTime,
  confirmedAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
  releaseReason: ReleaseReasonSchema.nullable(),
});
export type ReservationDetail = z.infer<typeof ReservationDetailSchema>;

export const MyReservationsQuerySchema = z.object({
  scope: z.enum(['upcoming', 'past']).default('upcoming'),
});
export const MyReservationsResponseSchema = z.object({
  reservations: z.array(ReservationDetailSchema),
});
export type MyReservationsResponse = z.infer<typeof MyReservationsResponseSchema>;

/** BR-9 alternative room (attached to RELEASED/CLASS_CONFLICT events). */
export const AlternativeRoomSchema = z.object({
  roomId: Id,
  name: z.string(),
  buildingId: Id,
  buildingName: z.string(),
  capacity: z.number().int(),
  start: IsoDateTime,
  end: IsoDateTime,
});
export type AlternativeRoom = z.infer<typeof AlternativeRoomSchema>;

export const ReservationEventSchema = z.object({
  eventId: Id,
  type: ReservationEventTypeSchema,
  at: IsoDateTime,
  actorAlias: z.string().nullable(),
  reason: z.string().optional(),
  /** Class details / alternatives for CONFLICTED + RELEASED. Never contains PII. */
  details: z
    .object({
      class: z.record(z.unknown()).optional(),
      alternatives: z.array(AlternativeRoomSchema).optional(),
    })
    .optional(),
});
export const ReservationEventsResponseSchema = z.object({
  events: z.array(ReservationEventSchema),
});
export type ReservationEventsResponse = z.infer<typeof ReservationEventsResponseSchema>;
export type BuildingsResponse = z.infer<typeof BuildingsResponseSchema>;
export type RoomSearchResponse = z.infer<typeof RoomSearchResponseSchema>;

// ---------- Claims ----------
export const CreateClaimRequestSchema = z.object({
  message: SafeText(280).optional(),
  partySize: PartySize,
});
export type CreateClaimRequest = z.infer<typeof CreateClaimRequestSchema>;

export const ClaimSchema = z.object({
  claimId: Id,
  reservationId: Id,
  status: ClaimStatusSchema,
  mode: ApproveModeSchema.nullable(),
  message: z.string().optional(),
  partySize: PartySize,
  requesterAlias: z.string(),
  ownerAlias: z.string(),
  createdAt: IsoDateTime,
  expiresAt: IsoDateTime,
});
export type Claim = z.infer<typeof ClaimSchema>;

export const MyClaimsQuerySchema = z.object({ direction: z.enum(['incoming', 'outgoing']) });
export const MyClaimsResponseSchema = z.object({ claims: z.array(ClaimSchema) });

export const ApproveClaimRequestSchema = z.object({ mode: ApproveModeSchema });

/** The ONLY response shape that may carry contact info (BR-5). */
export const ContactRevealResponseSchema = z.object({
  channel: ShareChannelSchema,
  value: z.string(),
  expiresAt: IsoDateTime,
});
export type ContactRevealResponse = z.infer<typeof ContactRevealResponseSchema>;

// ---------- Notifications ----------
export const NotificationSchema = z.object({
  id: Id,
  type: z.string(),
  reservationId: Id.nullable(),
  title: z.string(),
  body: z.string(),
  read: z.boolean(),
  createdAt: IsoDateTime,
});
export type Notification = z.infer<typeof NotificationSchema>;
export const NotificationsQuerySchema = z.object({ cursor: z.string().max(1024).optional() });
export const NotificationsResponseSchema = z.object({
  notifications: z.array(NotificationSchema),
  nextCursor: z.string().nullable(),
});
export const MarkReadRequestSchema = z.union([
  z.object({ ids: z.array(Id).min(1).max(100) }),
  z.object({ all: z.literal(true) }),
]);

// ---------- Admin ----------
export const AdminReleaseRequestSchema = z.object({ reason: SafeText(200).optional() });
export const SyncRunSchema = z.object({
  runId: Id,
  source: z.string(),
  status: z.enum(['SUCCESS', 'PARTIAL', 'FAILED']),
  startedAt: IsoDateTime,
  durationMs: z.number().int(),
  counts: z.record(z.number().int()),
});
export const SyncRunsResponseSchema = z.object({ runs: z.array(SyncRunSchema) });

export const HealthResponseSchema = z.object({ ok: z.literal(true) });
