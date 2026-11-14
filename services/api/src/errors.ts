import type { ErrorCode } from '@freeroom/shared';

/** Throw from anywhere; app.onError maps it to the PRD §7 error shape + status. */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string = code,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

interface SafeParser<T> {
  safeParse(
    data: unknown,
  ):
    | { success: true; data: T }
    | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } };
}

/** zod parse at the trust boundary → 400 VALIDATION_ERROR with field issues. */
export function parse<T>(schema: SafeParser<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  throw new AppError('VALIDATION_ERROR', 'Invalid request', {
    issues: r.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })),
  });
}
