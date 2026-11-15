import { z } from 'zod';

/** PRD §7 error codes, plus the generic codes every API needs. */
export const ERROR_STATUS = {
  // PRD §7
  INVALID_SLOT_BOUNDARY: 400,
  DURATION_EXCEEDED: 400,
  IN_PAST: 400,
  OWN_RESERVATION: 400,
  CLASS_CONFLICT: 409,
  SLOT_TAKEN: 409,
  CUTOFF_PASSED: 409,
  TOO_EARLY: 409,
  NOT_CLAIMABLE: 409,
  CLAIM_EXISTS: 409,
  UID_ALREADY_REGISTERED: 409,
  QUOTA_EXCEEDED: 429,
  SCHEDULE_UNAVAILABLE: 503,
  // Generic / not named in §7
  BEYOND_HORIZON: 400, // start beyond the 7-day booking horizon (PRD §12.4)
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_TRANSITION: 409,
  RATE_LIMITED: 429,
  ROOM_FULL: 409, // invite join would exceed room capacity
  ROUTING_UNAVAILABLE: 503, // walking directions provider failed
  INTERNAL: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;
export const ERROR_CODES = Object.keys(ERROR_STATUS) as [ErrorCode, ...ErrorCode[]];
export const ErrorCodeSchema = z.enum(ERROR_CODES);

export const ApiErrorSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
