import { z } from 'zod';

export const RoleSchema = z.enum(['STUDENT', 'FACULTY', 'TUTOR', 'ADMIN']);
export type Role = z.infer<typeof RoleSchema>;

export const ReservationStatusSchema = z.enum([
  'PENDING_CONFIRMATION',
  'CONFIRMED',
  'CONFLICTED',
  'RELEASED',
  'CANCELLED',
  'COMPLETED',
]);
export type ReservationStatus = z.infer<typeof ReservationStatusSchema>;

export const ReleaseReasonSchema = z.enum(['UNCONFIRMED', 'CLASS_CONFLICT', 'ADMIN']);
export type ReleaseReason = z.infer<typeof ReleaseReasonSchema>;

export const ClaimStatusSchema = z.enum(['PENDING', 'APPROVED', 'DENIED', 'EXPIRED', 'WITHDRAWN']);
export type ClaimStatus = z.infer<typeof ClaimStatusSchema>;

export const ApproveModeSchema = z.enum(['SHARE_CONTACT', 'TRANSFER']);
export type ApproveMode = z.infer<typeof ApproveModeSchema>;

export const ShareChannelSchema = z.enum(['email', 'phone']);
export type ShareChannel = z.infer<typeof ShareChannelSchema>;

export const ReservationEventTypeSchema = z.enum([
  'CREATED',
  'CONFIRMED',
  'CLAIM_REQUESTED',
  'CLAIM_APPROVED',
  'CLAIM_DENIED',
  'CLAIM_EXPIRED',
  'TRANSFERRED',
  'RELEASED',
  'CANCELLED',
  'CONFLICTED',
  'ATTENDEE_JOINED',
  'ATTENDEE_LEFT',
]);
export type ReservationEventType = z.infer<typeof ReservationEventTypeSchema>;

export const EquipmentSchema = z.enum([
  'projector',
  'whiteboard',
  'computers',
  'outlets',
  'accessible',
]);
export type Equipment = z.infer<typeof EquipmentSchema>;

/** Status chip shown in search results (F1). */
export const RoomStatusSchema = z.enum([
  'FREE',
  'CLASS_IN_PROGRESS',
  'RESERVED_CLAIMABLE',
  'RESERVED',
]);
export type RoomStatus = z.infer<typeof RoomStatusSchema>;
